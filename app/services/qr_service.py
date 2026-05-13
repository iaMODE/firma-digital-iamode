from pathlib import Path
import qrcode


BASE_DIR = Path(__file__).resolve().parents[2]
TEMP_DIR = BASE_DIR / "temp"
QR_DIR = TEMP_DIR / "qr_codes"

QR_DIR.mkdir(parents=True, exist_ok=True)


def generate_qr_code(fd_code, verify_url):
    qr_path = QR_DIR / f"{fd_code}.png"

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )

    qr.add_data(verify_url)
    qr.make(fit=True)

    image = qr.make_image(
        fill_color="black",
        back_color="white"
    )

    image.save(qr_path)

    return qr_path