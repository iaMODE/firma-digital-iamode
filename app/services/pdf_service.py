import base64
import hashlib
import json
import os
import re
import time
from datetime import datetime
from io import BytesIO
from pathlib import Path

import fitz
import qrcode
from PIL import Image


BASE_DIR = Path(__file__).resolve().parents[2]
UPLOADS_DIR = BASE_DIR / "uploads"
SIGNED_DIR = BASE_DIR / "signed"
TEMP_DIR = BASE_DIR / "temp"
QR_DIR = TEMP_DIR / "qr_codes"

COUNTER_FILE = TEMP_DIR / "fd_counter.json"

FD_PATTERN = re.compile(r"FD-(\d{4})-(\d{6})")


def ensure_directories():
    UPLOADS_DIR.mkdir(exist_ok=True)
    SIGNED_DIR.mkdir(exist_ok=True)
    TEMP_DIR.mkdir(exist_ok=True)
    QR_DIR.mkdir(exist_ok=True)


def cleanup_temp_files(max_age_hours=48):
    ensure_directories()

    now = time.time()
    max_age_seconds = max_age_hours * 60 * 60

    folders = [
        TEMP_DIR,
        QR_DIR,
    ]

    for folder in folders:

        for file_path in folder.glob("*"):

            try:
                if not file_path.is_file():
                    continue

                if file_path == COUNTER_FILE:
                    continue

                file_age = now - file_path.stat().st_mtime

                if file_age > max_age_seconds:
                    file_path.unlink()

            except Exception:
                continue


def _extract_fd_number(fd_code, year):
    match = FD_PATTERN.search(str(fd_code))

    if not match:
        return 0

    fd_year = int(match.group(1))
    fd_number = int(match.group(2))

    if fd_year != year:
        return 0

    return fd_number


def _get_highest_local_fd_number(year):
    highest = 0

    folders = [
        UPLOADS_DIR,
        SIGNED_DIR,
        TEMP_DIR / "signature_requests",
    ]

    for folder in folders:

        if not folder.exists():
            continue

        for path in folder.glob("*"):

            highest = max(
                highest,
                _extract_fd_number(path.name, year)
            )

    return highest


def _get_highest_gcs_fd_number(year):
    highest = 0

    try:
        from app.services.storage_service import list_metadata_json_from_gcs

        metadata_items = list_metadata_json_from_gcs()

        for item in metadata_items:

            if not item:
                continue

            highest = max(
                highest,
                _extract_fd_number(
                    item.get("fd_code", ""),
                    year
                )
            )

            highest = max(
                highest,
                _extract_fd_number(
                    item.get("gcs_original_blob", ""),
                    year
                )
            )

            highest = max(
                highest,
                _extract_fd_number(
                    item.get("gcs_signed_blob", ""),
                    year
                )
            )

    except Exception:
        pass

    return highest


def get_next_fd_code():
    ensure_directories()

    year = datetime.now().year
    current_year = str(year)

    counter_number = 0

    if COUNTER_FILE.exists():

        try:
            with open(COUNTER_FILE, "r", encoding="utf-8") as file:
                data = json.load(file)

            counter_number = int(data.get(current_year, 0))

        except Exception:
            data = {}

    else:
        data = {}

    highest_number = max(
        counter_number,
        _get_highest_local_fd_number(year),
        _get_highest_gcs_fd_number(year)
    )

    next_number = highest_number + 1

    data[current_year] = next_number

    with open(COUNTER_FILE, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4)

    return f"FD-{year}-{next_number:06d}"


def extract_existing_fd_code_from_pdf(pdf_path):
    fd_pattern = re.compile(r"FD-\d{4}-\d{6}")

    filename_match = fd_pattern.search(str(pdf_path))

    if filename_match:
        return filename_match.group(0)

    try:
        doc = fitz.open(pdf_path)

        pages_to_check = []

        if len(doc) > 0:
            pages_to_check.append(0)

        if len(doc) > 1:
            pages_to_check.append(len(doc) - 1)

        for page_index in pages_to_check:
            text = doc[page_index].get_text("text")
            match = fd_pattern.search(text)

            if match:
                doc.close()
                return match.group(0)

        doc.close()

    except Exception:
        return None

    return None


def calculate_sha256(file_path):
    sha256 = hashlib.sha256()

    with open(file_path, "rb") as file:
        for chunk in iter(lambda: file.read(8192), b""):
            sha256.update(chunk)

    return sha256.hexdigest()


def save_uploaded_pdf(pdf_file):
    ensure_directories()
    cleanup_temp_files()

    safe_name = pdf_file.filename.replace("\\", "_").replace("/", "_")

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")

    filename = f"{timestamp}_{safe_name}"

    output_path = UPLOADS_DIR / filename

    pdf_file.save(output_path)

    return output_path


def decode_signature_image(data_url):
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]

    return base64.b64decode(data_url)


def rotate_signature_image_bytes(image_bytes, rotation_degrees):
    try:
        rotation = float(rotation_degrees or 0)

        if abs(rotation) < 0.01:
            return image_bytes

        image = Image.open(BytesIO(image_bytes)).convert("RGBA")

        rotated_image = image.rotate(
            -rotation,
            expand=True,
            resample=Image.Resampling.BICUBIC,
            fillcolor=(255, 255, 255, 0),
        )

        buffer = BytesIO()
        rotated_image.save(buffer, format="PNG")

        return buffer.getvalue()

    except Exception:
        return image_bytes


def get_verification_url(fd_code, verify_base_url=None):
    base_url = (
        verify_base_url
        or os.environ.get("VERIFY_BASE_URL")
        or os.environ.get("APP_BASE_URL")
        or ""
    ).strip().rstrip("/")

    if base_url:
        return f"{base_url}/verificar/{fd_code}"

    return f"/verificar/{fd_code}"


def generate_qr_png_bytes(fd_code, verify_base_url=None):
    verification_url = get_verification_url(
        fd_code,
        verify_base_url
    )

    qr = qrcode.QRCode(
        version=2,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=6,
        border=2,
    )

    qr.add_data(verification_url)
    qr.make(fit=True)

    image = qr.make_image(
        fill_color="black",
        back_color="white"
    )

    buffer = BytesIO()

    image.save(buffer, format="PNG")

    return buffer.getvalue()


def insert_verification_stamp(
    doc,
    fd_code,
    verify_base_url=None
):
    if len(doc) == 0:
        return

    page = doc[-1]
    page_rect = page.rect

    qr_bytes = generate_qr_png_bytes(
        fd_code,
        verify_base_url
    )

    margin_right = 8
    margin_bottom = 8

    qr_size = 42
    text_gap = 4
    text_width = 82
    line_height = 10

    block_width = qr_size + text_gap + text_width
    block_height = qr_size

    x1 = page_rect.width - margin_right
    y1 = page_rect.height - margin_bottom

    x0 = x1 - block_width
    y0 = y1 - block_height

    background_rect = fitz.Rect(
        x0 - 3,
        y0 - 3,
        x1 + 3,
        y1 + 3
    )

    page.draw_rect(
        background_rect,
        color=(0.82, 0.86, 0.92),
        fill=(1, 1, 1),
        width=0.35,
        overlay=True,
    )

    qr_rect = fitz.Rect(
        x0,
        y0,
        x0 + qr_size,
        y0 + qr_size,
    )

    page.insert_image(
        qr_rect,
        stream=qr_bytes,
        keep_proportion=True,
        overlay=True,
    )

    text_x = qr_rect.x1 + text_gap
    text_y = y0 + 9

    page.insert_text(
        fitz.Point(text_x, text_y),
        "Firma Digital",
        fontsize=6.7,
        fontname="helv",
        color=(0.15, 0.18, 0.25),
        overlay=True,
    )

    page.insert_text(
        fitz.Point(text_x, text_y + line_height),
        fd_code,
        fontsize=6.9,
        fontname="helv",
        color=(0.02, 0.08, 0.20),
        overlay=True,
    )

    page.insert_text(
        fitz.Point(text_x, text_y + (line_height * 2)),
        "iaMODE",
        fontsize=6,
        fontname="helv",
        color=(0.42, 0.46, 0.55),
        overlay=True,
    )


def apply_signatures_to_pdf(
    original_pdf_path,
    signatures,
    fd_code=None,
    verify_base_url=None
):
    ensure_directories()
    cleanup_temp_files()

    if not fd_code:
        fd_code = get_next_fd_code()

    signed_filename = f"{fd_code}.pdf"

    signed_path = SIGNED_DIR / signed_filename

    temp_signed_path = (
        TEMP_DIR / f"{fd_code}_tmp_signed.pdf"
    )

    doc = fitz.open(original_pdf_path)

    for signature in signatures:

        page_number = int(
            signature.get("page", 1)
        ) - 1

        if page_number < 0 or page_number >= len(doc):
            continue

        page = doc[page_number]
        page_rect = page.rect

        image_bytes = decode_signature_image(
            signature.get("image", "")
        )

        rotation = float(
            signature.get("rotation", 0) or 0
        )

        image_bytes = rotate_signature_image_bytes(
            image_bytes,
            rotation
        )

        left_percent = float(
            signature.get("leftPercent", 0)
        )

        top_percent = float(
            signature.get("topPercent", 0)
        )

        width_percent = float(
            signature.get("widthPercent", 0.22)
        )

        pix = fitz.Pixmap(image_bytes)

        image_ratio = (
            pix.height / pix.width
            if pix.width else 0.35
        )

        pix = None

        img_width = page_rect.width * width_percent
        img_height = img_width * image_ratio

        x0 = page_rect.width * left_percent
        y0 = page_rect.height * top_percent

        x1 = x0 + img_width
        y1 = y0 + img_height

        signature_rect = fitz.Rect(
            x0,
            y0,
            x1,
            y1
        )

        page.insert_image(
            signature_rect,
            stream=image_bytes,
            keep_proportion=True,
            overlay=True,
        )

    insert_verification_stamp(
        doc,
        fd_code,
        verify_base_url
    )

    if temp_signed_path.exists():
        temp_signed_path.unlink()

    doc.save(
        temp_signed_path,
        garbage=4,
        deflate=True
    )

    doc.close()

    if signed_path.exists():
        signed_path.unlink()

    temp_signed_path.replace(signed_path)

    pdf_hash = calculate_sha256(signed_path)

    return {
        "fd_code": fd_code,
        "signed_filename": signed_filename,
        "signed_path": str(signed_path),
        "hash_sha256": pdf_hash,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }