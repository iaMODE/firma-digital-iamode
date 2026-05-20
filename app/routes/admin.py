from flask import (
    Blueprint,
    render_template,
    request,
    redirect,
    url_for,
    session,
    current_app,
    send_file,
)

from pathlib import Path
from datetime import datetime, timedelta
from functools import wraps
import json

from app.services.pdf_service import (
    save_uploaded_pdf,
    get_next_fd_code,
    extract_existing_fd_code_from_pdf,
)

from app.services.storage_service import (
    upload_file_to_gcs,
    upload_json_to_gcs,
    download_json_from_gcs,
    list_metadata_json_from_gcs,
    gcs_file_exists,
    download_file_from_gcs,
    delete_signature_request_files_from_gcs,
)

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")

BASE_DIR = Path(__file__).resolve().parents[2]
TEMP_DIR = BASE_DIR / "temp"
REQUESTS_DIR = TEMP_DIR / "signature_requests"
SIGNED_DIR = BASE_DIR / "signed"

DEFAULT_COVER_IMAGE = "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhCNtbT7l6GSHFWqW0puQy54R6qK81_CaHqjnh7fDs_IYYSNsjNHmzpw16T9uRC-mynE6tDwwwJKPoMt6RXc5Yoi-zHVcpAIkEPSnvEQfgS1_nP50m4Vr3cTdUIPRdz7MyAur2o96nRm2g50OtKMRITq4Hkf_0AnglcFngo1AusMUxkgtiSdCqu9fcjNGo/s800/70.png"

SIGNATURE_COLORS = {
    "#1f2937": "Negro",
    "#1d4ed8": "Azul tinta",
    "#1e3a8a": "Azul oscuro",
}

DEFAULT_SIGNATURE_COLOR = "#1d4ed8"
DEFAULT_ALLOWED_SIGNATURES = 1

TEMP_DIR.mkdir(exist_ok=True)
REQUESTS_DIR.mkdir(exist_ok=True)
SIGNED_DIR.mkdir(exist_ok=True)


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):

        if not session.get("admin_logged_in"):
            return redirect(url_for("admin.login"))

        return view(*args, **kwargs)

    return wrapped_view


def _request_meta_path(fd_code):
    return REQUESTS_DIR / f"{fd_code}.json"


def _request_meta_blob(fd_code):
    return f"metadata/{fd_code}.json"


def _safe_datetime(value):

    if not value:
        return datetime.min

    if isinstance(value, datetime):
        return value

    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        pass

    try:
        return datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S")
    except Exception:
        pass

    return datetime.min


def _normalize_signature_data(data):

    if not data or not isinstance(data, dict):
        return None

    if "allowed_signatures" not in data:
        data["allowed_signatures"] = DEFAULT_ALLOWED_SIGNATURES

    if "signatures_count" not in data:
        data["signatures_count"] = 0

    return data


def _render_admin_file_unavailable(fd_code):
    return render_template(
        "admin_file_unavailable.html",
        fd_code=fd_code
    ), 404


def _load_signature_request(fd_code):

    meta_path = _request_meta_path(fd_code)

    if meta_path.exists():

        try:
            with open(meta_path, "r", encoding="utf-8") as file:
                data = json.load(file)
                return _normalize_signature_data(data)

        except Exception:
            pass

    gcs_data = download_json_from_gcs(
        _request_meta_blob(fd_code)
    )

    if gcs_data:

        normalized = _normalize_signature_data(gcs_data)

        if normalized:
            _save_signature_request(
                fd_code,
                normalized
            )

        return normalized

    return None


def _load_all_signature_requests():

    requests_map = {}

    local_files = list(
        REQUESTS_DIR.glob("*.json")
    )

    for meta_file in local_files:

        try:
            with open(meta_file, "r", encoding="utf-8") as file:

                data = json.load(file)

                normalized = _normalize_signature_data(data)

                if not normalized:
                    continue

                fd_code = normalized.get("fd_code")

                if not fd_code:
                    continue

                requests_map[fd_code] = normalized

        except Exception:
            continue

    gcs_requests = list_metadata_json_from_gcs()

    for data in gcs_requests:

        normalized = _normalize_signature_data(data)

        if not normalized:
            continue

        fd_code = normalized.get("fd_code")

        if not fd_code:
            continue

        current_data = requests_map.get(fd_code)

        if not current_data:
            requests_map[fd_code] = normalized
            continue

        current_updated = _safe_datetime(
            current_data.get("signed_at")
            or current_data.get("updated_at")
            or current_data.get("created_at")
        )

        gcs_updated = _safe_datetime(
            normalized.get("signed_at")
            or normalized.get("updated_at")
            or normalized.get("created_at")
        )

        if gcs_updated >= current_updated:
            requests_map[fd_code] = normalized

    requests = list(requests_map.values())

    requests.sort(
        key=lambda item: _safe_datetime(
            item.get("created_at")
        ),
        reverse=True
    )

    return requests


def _save_signature_request(fd_code, data):

    normalized = _normalize_signature_data(data)

    if not normalized:
        return

    meta_path = _request_meta_path(fd_code)

    with open(meta_path, "w", encoding="utf-8") as file:
        json.dump(
            normalized,
            file,
            ensure_ascii=False,
            indent=4
        )

    upload_json_to_gcs(
        normalized,
        _request_meta_blob(fd_code)
    )


@admin_bp.route("/login", methods=["GET", "POST"])
def login():

    if session.get("admin_logged_in"):
        return redirect(url_for("admin.dashboard"))

    error = None

    if request.method == "POST":

        username = request.form.get(
            "username",
            ""
        ).strip()

        password = request.form.get(
            "password",
            ""
        ).strip()

        admin_user = current_app.config.get("ADMIN_USER")
        admin_password = current_app.config.get("ADMIN_PASSWORD")

        if (
            username == admin_user
            and password == admin_password
        ):

            session["admin_logged_in"] = True

            return redirect(url_for("admin.dashboard"))

        error = "Usuario o contraseña incorrectos."

    return render_template(
        "login.html",
        error=error
    )


@admin_bp.route("/logout")
def logout():

    session.clear()

    return redirect(url_for("admin.login"))


@admin_bp.route("/")
@login_required
def dashboard():

    signature_requests = _load_all_signature_requests()

    return render_template(
        "admin.html",
        signature_requests=signature_requests
    )


@admin_bp.route("/descargar/<fd_code>")
@login_required
def admin_download_pdf(fd_code):

    data = _load_signature_request(fd_code)

    if not data:
        return _render_admin_file_unavailable(fd_code)

    signed_filename = data.get("signed_filename") or f"{fd_code}.pdf"
    signed_filename = Path(signed_filename).name
    signed_path = SIGNED_DIR / signed_filename

    signed_blob = data.get("gcs_signed_blob") or f"signed/{fd_code}.pdf"

    if signed_path.exists():
        return send_file(
            signed_path,
            as_attachment=True,
            download_name=signed_filename
        )

    if signed_blob and gcs_file_exists(signed_blob):

        downloaded = download_file_from_gcs(
            signed_blob,
            signed_path
        )

        if downloaded and signed_path.exists():
            return send_file(
                signed_path,
                as_attachment=True,
                download_name=signed_filename
            )

    original_pdf_path_raw = data.get("original_pdf_path", "")
    original_pdf_path = Path(original_pdf_path_raw) if original_pdf_path_raw else None

    if original_pdf_path and original_pdf_path.exists():
        return send_file(
            original_pdf_path,
            as_attachment=True,
            download_name=original_pdf_path.name
        )

    original_blob = data.get("gcs_original_blob") or f"original/{fd_code}.pdf"

    original_filename = data.get("original_filename") or f"{fd_code}-original.pdf"
    original_filename = Path(original_filename).name
    local_original_path = TEMP_DIR / original_filename

    if original_blob and gcs_file_exists(original_blob):

        downloaded = download_file_from_gcs(
            original_blob,
            local_original_path
        )

        if downloaded and local_original_path.exists():
            return send_file(
                local_original_path,
                as_attachment=True,
                download_name=original_filename
            )

    return _render_admin_file_unavailable(fd_code)


@admin_bp.route("/solicitud/<fd_code>")
@login_required
def request_details(fd_code):

    data = _load_signature_request(fd_code)

    if not data:
        return redirect(url_for("admin.dashboard"))

    original_pdf_exists = False
    signed_pdf_exists = False

    original_pdf_path = Path(
        data.get("original_pdf_path", "")
    )

    if original_pdf_path.exists():
        original_pdf_exists = True

    elif gcs_file_exists(data.get("gcs_original_blob")):
        original_pdf_exists = True

    signed_filename = data.get("signed_filename")

    if signed_filename:

        signed_pdf_path = SIGNED_DIR / signed_filename

        if signed_pdf_path.exists():
            signed_pdf_exists = True

        elif gcs_file_exists(data.get("gcs_signed_blob")):
            signed_pdf_exists = True

    return render_template(
        "request_details.html",
        data=data,
        original_pdf_exists=original_pdf_exists,
        signed_pdf_exists=signed_pdf_exists,
        gcs_enabled=True
    )


@admin_bp.route("/crear-solicitud", methods=["POST"])
@login_required
def create_signature_request():

    pdf_file = request.files.get("pdf")

    if not pdf_file:
        return redirect(url_for("admin.dashboard"))

    document_title = request.form.get(
        "document_title",
        ""
    ).strip()

    document_description = request.form.get(
        "document_description",
        ""
    ).strip()

    cover_image = request.form.get(
        "cover_image",
        ""
    ).strip()

    signature_color = request.form.get(
        "signature_color",
        DEFAULT_SIGNATURE_COLOR
    ).strip()

    allowed_signatures_raw = request.form.get(
        "allowed_signatures",
        ""
    ).strip()

    if signature_color not in SIGNATURE_COLORS:
        signature_color = DEFAULT_SIGNATURE_COLOR

    try:
        allowed_signatures = int(allowed_signatures_raw)

        if allowed_signatures < 1:
            allowed_signatures = DEFAULT_ALLOWED_SIGNATURES

    except Exception:
        allowed_signatures = DEFAULT_ALLOWED_SIGNATURES

    if not document_title:
        document_title = pdf_file.filename

    if not document_description:
        document_description = (
            "Documento disponible para firma digital segura."
        )

    if not cover_image:
        cover_image = DEFAULT_COVER_IMAGE

    original_pdf_path = save_uploaded_pdf(pdf_file)

    existing_fd_code = extract_existing_fd_code_from_pdf(
        original_pdf_path
    )

    fd_code = existing_fd_code or get_next_fd_code()

    created_at = datetime.now()

    expires_at = created_at + timedelta(hours=48)

    original_blob_name = (
        f"original/{fd_code}.pdf"
    )

    signed_blob_name = (
        f"signed/{fd_code}.pdf"
    )

    metadata_blob_name = (
        f"metadata/{fd_code}.json"
    )

    uploaded_original_blob = upload_file_to_gcs(
        original_pdf_path,
        original_blob_name
    )

    data = {
        "fd_code": fd_code,
        "status": "pendiente",
        "document_title": document_title,
        "document_description": document_description,
        "cover_image": cover_image,
        "signature_color": signature_color,
        "allowed_signatures": allowed_signatures,
        "signatures_count": 0,
        "original_filename": pdf_file.filename,
        "original_pdf_path": str(original_pdf_path),
        "signed_filename": None,
        "hash_sha256": None,
        "created_at": created_at.strftime("%Y-%m-%d %H:%M:%S"),
        "expires_at": expires_at.isoformat(),
        "signed_at": None,
        "sign_url": url_for(
            "public.remote_sign",
            fd_code=fd_code,
            _external=True
        ),
        "download_url": None,
        "gcs_original_blob": uploaded_original_blob,
        "gcs_signed_blob": signed_blob_name,
        "gcs_metadata_blob": metadata_blob_name,
    }

    _save_signature_request(fd_code, data)

    return redirect(url_for("admin.dashboard"))


@admin_bp.route(
    "/eliminar-solicitud/<fd_code>",
    methods=["POST"]
)
@login_required
def delete_signature_request(fd_code):

    data = _load_signature_request(fd_code)

    if not data:
        return redirect(url_for("admin.dashboard"))

    try:

        delete_signature_request_files_from_gcs(data)

        signed_filename = data.get("signed_filename")

        if signed_filename:

            signed_path = SIGNED_DIR / signed_filename

            if signed_path.exists():
                signed_path.unlink()

        original_pdf_path = Path(
            data.get("original_pdf_path", "")
        )

        if original_pdf_path.exists():
            original_pdf_path.unlink()

        meta_path = _request_meta_path(fd_code)

        if meta_path.exists():
            meta_path.unlink()

    except Exception:
        pass

    return redirect(url_for("admin.dashboard"))