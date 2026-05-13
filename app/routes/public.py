from flask import (
    Blueprint,
    render_template,
    redirect,
    url_for,
    request,
    jsonify,
    send_file,
)

from pathlib import Path
from datetime import datetime, timedelta
from user_agents import parse
import json

from app.services.pdf_service import (
    save_uploaded_pdf,
    apply_signatures_to_pdf,
)

from app.services.storage_service import (
    upload_file_to_gcs,
    download_file_from_gcs,
    gcs_file_exists,
    cleanup_old_local_pdfs,
)

public_bp = Blueprint("public", __name__)

BASE_DIR = Path(__file__).resolve().parents[2]

UPLOADS_DIR = BASE_DIR / "uploads"
SIGNED_DIR = BASE_DIR / "signed"
TEMP_DIR = BASE_DIR / "temp"
REQUESTS_DIR = TEMP_DIR / "signature_requests"

UPLOADS_DIR.mkdir(exist_ok=True)
SIGNED_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)
REQUESTS_DIR.mkdir(exist_ok=True)

cleanup_old_local_pdfs(UPLOADS_DIR)
cleanup_old_local_pdfs(SIGNED_DIR)


def _request_meta_path(fd_code):
    return REQUESTS_DIR / f"{fd_code}.json"


def _load_signature_request(fd_code):
    meta_path = _request_meta_path(fd_code)

    if not meta_path.exists():
        return None

    with open(meta_path, "r", encoding="utf-8") as file:
        return json.load(file)


def _save_signature_request(fd_code, data):
    meta_path = _request_meta_path(fd_code)

    with open(meta_path, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=4)


def _is_expired(data):
    expires_at = data.get("expires_at")

    if not expires_at:
        return False

    expires_dt = datetime.fromisoformat(expires_at)
    return datetime.now() > expires_dt


def _is_signed_download_expired(data):
    expires_at = data.get("signed_download_expires_at")

    if expires_at:
        try:
            return datetime.now() > datetime.fromisoformat(expires_at)
        except Exception:
            pass

    signed_at = data.get("signed_at") or data.get("last_signed_at")

    if not signed_at:
        return False

    try:
        signed_dt = datetime.fromisoformat(signed_at)
    except Exception:
        try:
            signed_dt = datetime.strptime(signed_at, "%Y-%m-%d %H:%M:%S")
        except Exception:
            return False

    return datetime.now() > signed_dt + timedelta(hours=48)


def _has_reached_signature_limit(data):
    allowed_signatures = int(data.get("allowed_signatures", 1))
    signatures_count = int(data.get("signatures_count", 0))

    return signatures_count >= allowed_signatures


def _ensure_original_pdf_available(data):
    original_pdf_path = Path(
        data.get("original_pdf_path", "")
    )

    if original_pdf_path.exists():
        return original_pdf_path

    gcs_original_blob = data.get("gcs_original_blob")

    if not gcs_original_blob:
        return original_pdf_path

    downloaded = download_file_from_gcs(
        gcs_original_blob,
        original_pdf_path
    )

    if downloaded and original_pdf_path.exists():
        return original_pdf_path

    return original_pdf_path


def _ensure_signed_pdf_available(data):
    signed_filename = data.get("signed_filename")

    if not signed_filename:
        return None

    signed_pdf_path = SIGNED_DIR / signed_filename

    if signed_pdf_path.exists():
        return signed_pdf_path

    gcs_signed_blob = data.get("gcs_signed_blob")

    if not gcs_signed_blob:
        return signed_pdf_path

    if not gcs_file_exists(gcs_signed_blob):
        return signed_pdf_path

    downloaded = download_file_from_gcs(
        gcs_signed_blob,
        signed_pdf_path
    )

    if downloaded and signed_pdf_path.exists():
        return signed_pdf_path

    return signed_pdf_path


def _get_current_pdf_path_for_signing(data):
    signed_pdf_path = _ensure_signed_pdf_available(data)

    if signed_pdf_path and signed_pdf_path.exists():
        return signed_pdf_path

    return _ensure_original_pdf_available(data)


def _get_client_ip():
    forwarded_for = request.headers.get(
        "X-Forwarded-For",
        ""
    )

    if forwarded_for:

        ip_list = [
            ip.strip()
            for ip in forwarded_for.split(",")
            if ip.strip()
        ]

        if ip_list:
            return ip_list[0]

    real_ip = request.headers.get(
        "X-Real-IP",
        ""
    )

    if real_ip:
        return real_ip.strip()

    remote_addr = request.remote_addr

    if remote_addr:
        return remote_addr.strip()

    return "No disponible"

def _build_signature_trace_event(signed_at, hash_sha256):
    user_agent_string = request.headers.get("User-Agent", "")
    user_agent = parse(user_agent_string)

    device_type = "PC"

    if user_agent.is_mobile:
        device_type = "Mobile"

    elif user_agent.is_tablet:
        device_type = "Tablet"

    elif user_agent.is_bot:
        device_type = "Bot"

    browser = (
        f"{user_agent.browser.family} "
        f"{user_agent.browser.version_string}"
    ).strip()

    operating_system = (
        f"{user_agent.os.family} "
        f"{user_agent.os.version_string}"
    ).strip()

    return {
        "signed_at": signed_at,
        "ip": _get_client_ip(),
        "device": device_type,
        "browser": browser or "No disponible",
        "os": operating_system or "No disponible",
        "user_agent": user_agent_string,
        "hash_sha256": hash_sha256,
    }


@public_bp.route("/")
def index():
    return redirect(url_for("public.sign"))


@public_bp.route("/sign")
def sign():
    return render_template(
        "sign.html",
        remote_mode=False,
        fd_code=None,
        initial_pdf_url=None,
        signature_color="#1d4ed8"
    )


@public_bp.route("/firma/<fd_code>")
def remote_sign(fd_code):
    data = _load_signature_request(fd_code)

    if not data:
        return render_template("request_unavailable.html", fd_code=fd_code), 404

    if _is_expired(data):
        return render_template("expired_link.html", fd_code=fd_code), 410

    if _has_reached_signature_limit(data):
        return render_template(
            "limit_reached.html",
            fd_code=fd_code,
            document_title=data.get("document_title", "Documento")
        )

    signature_color = data.get("signature_color", "#1d4ed8")
    signed_filename = data.get("signed_filename")

    if signed_filename:

        signed_pdf_path = _ensure_signed_pdf_available(data)

        if signed_pdf_path and signed_pdf_path.exists():
            return render_template(
                "sign.html",
                remote_mode=True,
                fd_code=fd_code,
                document_title=data.get("document_title", "Documento para firmar"),
                initial_pdf_url=url_for("public.get_signed_pdf_for_signing", fd_code=fd_code),
                signature_color=signature_color,
                og_title=data.get("document_title", "Firma Digital iaMODE"),
                og_description=data.get(
                    "document_description",
                    "Documento disponible para firma digital segura."
                ),
                og_image=data.get("cover_image")
            )

    return render_template(
        "sign.html",
        remote_mode=True,
        fd_code=fd_code,
        document_title=data.get("document_title", "Documento para firmar"),
        initial_pdf_url=url_for("public.get_original_pdf", fd_code=fd_code),
        signature_color=signature_color,
        og_title=data.get("document_title", "Firma Digital iaMODE"),
        og_description=data.get(
            "document_description",
            "Documento disponible para firma digital segura."
        ),
        og_image=data.get("cover_image")
    )


@public_bp.route("/api/original-pdf/<fd_code>")
def get_original_pdf(fd_code):
    data = _load_signature_request(fd_code)

    if not data:
        return render_template("request_unavailable.html", fd_code=fd_code), 404

    if _is_expired(data):
        return render_template("expired_link.html", fd_code=fd_code), 410

    original_pdf_path = _ensure_original_pdf_available(data)

    if not original_pdf_path.exists():
        return "PDF original no encontrado", 404

    return send_file(
        original_pdf_path,
        as_attachment=False,
        download_name=f"{fd_code}-original.pdf"
    )


@public_bp.route("/api/signed-pdf/<fd_code>")
def get_signed_pdf_for_signing(fd_code):
    data = _load_signature_request(fd_code)

    if not data:
        return render_template("request_unavailable.html", fd_code=fd_code), 404

    if _is_expired(data):
        return render_template("expired_link.html", fd_code=fd_code), 410

    signed_pdf_path = _ensure_signed_pdf_available(data)

    if not signed_pdf_path or not signed_pdf_path.exists():
        return "PDF firmado no encontrado", 404

    return send_file(
        signed_pdf_path,
        as_attachment=False,
        download_name=f"{fd_code}.pdf"
    )


@public_bp.route("/success")
def success():
    return render_template("success.html")


@public_bp.route("/download/<fd_code>")
def download_signed_pdf(fd_code):
    data = _load_signature_request(fd_code)

    if not data:
        return render_template("request_unavailable.html", fd_code=fd_code), 404

    if _is_signed_download_expired(data):
        return render_template(
            "signed_download_expired.html",
            fd_code=fd_code,
            document_title=data.get("document_title", "Documento firmado")
        ), 410

    signed_pdf_path = _ensure_signed_pdf_available(data)

    if not signed_pdf_path or not signed_pdf_path.exists():
        return "Documento no encontrado", 404

    return send_file(
        signed_pdf_path,
        as_attachment=True,
        download_name=f"{fd_code}.pdf"
    )


@public_bp.route("/verificar/<fd_code>")
def verify_document(fd_code):
    data = _load_signature_request(fd_code)

    if not data:
        return "Documento no encontrado", 404

    signed_pdf_exists = False

    signed_pdf_path = _ensure_signed_pdf_available(data)

    if signed_pdf_path and signed_pdf_path.exists():
        signed_pdf_exists = True

    return render_template(
        "verify.html",
        fd_code=fd_code,
        data=data,
        signed_pdf_exists=signed_pdf_exists,
        og_title=f"Verificación {fd_code}",
        og_description=(
            "Documento firmado digitalmente y verificado "
            "mediante Firma Digital iaMODE."
        ),
        og_image=data.get("cover_image")
    )


@public_bp.route("/api/finalize", methods=["POST"])
def finalize_document():
    try:
        pdf_file = request.files.get("pdf")
        signatures_json = request.form.get("signatures")
        fd_code = request.form.get("fd_code")

        if not signatures_json:
            return jsonify({"success": False, "message": "No se recibieron firmas."}), 400

        signatures = json.loads(signatures_json)
        signature_request = None

        if fd_code:
            signature_request = _load_signature_request(fd_code)

            if not signature_request:
                return jsonify({"success": False, "message": "Solicitud de firma no encontrada."}), 404

            if _is_expired(signature_request):
                return jsonify({"success": False, "message": "Este enlace de firma ha expirado."}), 410

            if _has_reached_signature_limit(signature_request):
                return jsonify({"success": False, "message": "Límite de firmas alcanzado."}), 403

            original_pdf_path = _get_current_pdf_path_for_signing(signature_request)

            if not original_pdf_path.exists():
                return jsonify({"success": False, "message": "No se encontró el PDF base para firmar."}), 404

        else:
            if not pdf_file:
                return jsonify({"success": False, "message": "No se recibió el PDF."}), 400

            original_pdf_path = save_uploaded_pdf(pdf_file)

        result = apply_signatures_to_pdf(
            original_pdf_path=original_pdf_path,
            signatures=signatures,
            fd_code=fd_code
        )

        if signature_request:
            previous_count = int(signature_request.get("signatures_count", 0))
            signed_at = result["created_at"]

            signature_request["status"] = "firmado"
            signature_request["signed_at"] = signed_at
            signature_request["last_signed_at"] = signed_at
            signature_request["signed_download_expires_at"] = (
                datetime.now() + timedelta(hours=48)
            ).isoformat()
            signature_request["signatures_count"] = previous_count + 1
            signature_request["signed_filename"] = result["signed_filename"]
            signature_request["hash_sha256"] = result["hash_sha256"]
            signature_request["download_url"] = url_for(
                "public.download_signed_pdf",
                fd_code=result["fd_code"]
            )

            trace_events = signature_request.get(
                "trace_events",
                []
            )

            trace_events.append(
                _build_signature_trace_event(
                    signed_at=signed_at,
                    hash_sha256=result["hash_sha256"]
                )
            )

            signature_request["trace_events"] = trace_events

            signed_pdf_path = SIGNED_DIR / result["signed_filename"]

            if signed_pdf_path.exists():

                gcs_signed_blob = signature_request.get(
                    "gcs_signed_blob"
                )

                if gcs_signed_blob:
                    upload_file_to_gcs(
                        signed_pdf_path,
                        gcs_signed_blob
                    )

            _save_signature_request(
                result["fd_code"],
                signature_request
            )

        return jsonify({
            "success": True,
            "fd_code": result["fd_code"],
            "hash_sha256": result["hash_sha256"],
            "signed_filename": result["signed_filename"],
            "created_at": result["created_at"],
            "download_url": url_for(
                "public.download_signed_pdf",
                fd_code=result["fd_code"]
            ),
            "redirect_url": url_for(
                "public.success",
                code=result["fd_code"]
            )
        })

    except Exception as error:
        print(error)

        return jsonify({
            "success": False,
            "message": str(error)
        }), 500