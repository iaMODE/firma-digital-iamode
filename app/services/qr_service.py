import os
from pathlib import Path

import qrcode


BASE_DIR = Path(__file__).resolve().parents[2]
TEMP_DIR = BASE_DIR / "temp"
QR_DIR = TEMP_DIR / "qr_codes"

QR_DIR.mkdir(parents=True, exist_ok=True)


def _get_verify_base_url():
    return os.environ.get("VERIFY_BASE_URL", "").strip().rstrip("/")


def _build_absolute_verify_url(fd_code, verify_url):
    verify_url = (verify_url or "").strip()

    if verify_url.startswith("http://") or verify_url.startswith("https://"):
        return verify_url

    base_url = _get_verify_base_url()

    if not verify_url:
        verify_url = f"/verificar/{fd_code}"

    if not verify_url.startswith("/"):
        verify_url = f"/{verify_url}"

    if base_url:
        return f"{base_url}{verify_url}"

    return verify_url


def generate_qr_code(fd_code, verify_url):
    qr_path = QR_DIR / f"{fd_code}.png"

    absolute_verify_url = _build_absolute_verify_url(fd_code, verify_url)

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )

    qr.add_data(absolute_verify_url)
    qr.make(fit=True)

    image = qr.make_image(
        fill_color="black",
        back_color="white"
    )

    image.save(qr_path)

    return qr_path