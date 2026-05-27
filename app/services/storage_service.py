import os
import time
import json
from pathlib import Path

from google.cloud import storage


def _get_bucket_name():
    return os.environ.get("GCS_BUCKET_NAME", "").strip()


def is_gcs_enabled():
    return bool(_get_bucket_name())


def _get_bucket():
    bucket_name = _get_bucket_name()

    if not bucket_name:
        print("GCS DISABLED: GCS_BUCKET_NAME vacío")
        return None

    client = storage.Client()
    return client.bucket(bucket_name)


def upload_file_to_gcs(local_path, blob_name):
    if not is_gcs_enabled():
        print("GCS FILE UPLOAD SKIPPED: GCS no está habilitado")
        return None

    if not blob_name:
        print("GCS FILE UPLOAD SKIPPED: blob_name vacío")
        return None

    path = Path(local_path)

    if not path.exists():
        print(f"GCS FILE UPLOAD SKIPPED: archivo local no existe: {path}")
        return None

    try:
        bucket = _get_bucket()

        if not bucket:
            print("GCS FILE UPLOAD SKIPPED: bucket no disponible")
            return None

        blob = bucket.blob(blob_name)

        blob.upload_from_filename(
            str(path),
            content_type="application/pdf"
        )

        print(f"GCS FILE UPLOAD OK: {blob_name}")
        return blob_name

    except Exception as e:
        print("GCS UPLOAD ERROR:", str(e))
        return None


def download_file_from_gcs(blob_name, local_path):
    if not is_gcs_enabled():
        return False

    if not blob_name:
        return False

    try:
        bucket = _get_bucket()

        if not bucket:
            return False

        path = Path(local_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        blob = bucket.blob(blob_name)

        if not blob.exists():
            return False

        blob.download_to_filename(str(path))

        return path.exists()

    except Exception as e:
        print("GCS DOWNLOAD ERROR:", str(e))
        return False


def gcs_file_exists(blob_name):
    if not is_gcs_enabled():
        return False

    if not blob_name:
        return False

    try:
        bucket = _get_bucket()

        if not bucket:
            return False

        blob = bucket.blob(blob_name)

        return blob.exists()

    except Exception as e:
        print("GCS EXISTS ERROR:", str(e))
        return False


def delete_gcs_file(blob_name):
    if not is_gcs_enabled():
        return False

    if not blob_name:
        return False

    try:
        bucket = _get_bucket()

        if not bucket:
            return False

        blob = bucket.blob(blob_name)

        if not blob.exists():
            return True

        blob.delete()

        print(f"GCS DELETE OK: {blob_name}")
        return True

    except Exception as e:
        print("GCS DELETE ERROR:", str(e))
        return False


def upload_json_to_gcs(data, blob_name):
    if not is_gcs_enabled():
        print("GCS JSON UPLOAD SKIPPED: GCS no está habilitado")
        return None

    if not blob_name:
        print("GCS JSON UPLOAD SKIPPED: blob_name vacío")
        return None

    if data is None:
        print("GCS JSON UPLOAD SKIPPED: data vacío")
        return None

    try:
        bucket = _get_bucket()

        if not bucket:
            print("GCS JSON UPLOAD SKIPPED: bucket no disponible")
            return None

        blob = bucket.blob(blob_name)

        json_text = json.dumps(
            data,
            ensure_ascii=False,
            indent=4
        )

        blob.upload_from_string(
            json_text,
            content_type="application/json"
        )

        print(f"GCS JSON UPLOAD OK: {blob_name}")
        return blob_name

    except Exception as e:
        print("GCS JSON ERROR:", str(e))
        return None


def download_json_from_gcs(blob_name):
    if not is_gcs_enabled():
        return None

    if not blob_name:
        return None

    try:
        bucket = _get_bucket()

        if not bucket:
            return None

        blob = bucket.blob(blob_name)

        if not blob.exists():
            return None

        json_text = blob.download_as_text(
            encoding="utf-8"
        )

        return json.loads(json_text)

    except Exception as e:
        print("GCS JSON DOWNLOAD ERROR:", str(e))
        return None


def list_metadata_json_from_gcs(prefix="metadata/"):
    if not is_gcs_enabled():
        return []

    try:
        bucket = _get_bucket()

        if not bucket:
            return []

        metadata_items = []

        blobs = bucket.list_blobs(prefix=prefix)

        for blob in blobs:

            if not blob.name.endswith(".json"):
                continue

            try:
                json_text = blob.download_as_text(
                    encoding="utf-8"
                )

                data = json.loads(json_text)

                metadata_items.append(data)

            except Exception as e:
                print("GCS METADATA ITEM ERROR:", str(e))
                continue

        return metadata_items

    except Exception as e:
        print("GCS LIST METADATA ERROR:", str(e))
        return []


def delete_signature_request_files_from_gcs(data):
    if not data:
        return

    delete_gcs_file(data.get("gcs_original_blob"))
    delete_gcs_file(data.get("gcs_signed_blob"))
    delete_gcs_file(data.get("gcs_metadata_blob"))


def delete_local_file(local_path):
    if not local_path:
        return False

    path = Path(local_path)

    try:
        if path.exists() and path.is_file():
            path.unlink()
            return True

    except Exception:
        return False

    return False


def cleanup_old_local_pdfs(folder_path, max_age_hours=48):
    folder = Path(folder_path)

    if not folder.exists() or not folder.is_dir():
        return 0

    deleted_count = 0
    now = time.time()
    max_age_seconds = max_age_hours * 60 * 60

    for pdf_file in folder.glob("*.pdf"):

        try:
            file_age = now - pdf_file.stat().st_mtime

            if file_age > max_age_seconds:
                pdf_file.unlink()
                deleted_count += 1

        except Exception:
            continue

    return deleted_count