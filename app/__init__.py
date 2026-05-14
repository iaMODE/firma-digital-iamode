from flask import Flask, render_template
import os


def create_app():
    app = Flask(__name__)

    app.config["SECRET_KEY"] = os.environ.get(
        "SECRET_KEY",
        "firma-digital-iamode"
    )

    app.config["ADMIN_USER"] = os.environ.get(
        "ADMIN_USER",
        "admin"
    )

    app.config["ADMIN_PASSWORD"] = os.environ.get(
        "ADMIN_PASSWORD",
        "admin123"
    )

    app.config["MAX_CONTENT_LENGTH"] = (
        5 * 1024 * 1024
    )

    from app.routes.public import public_bp
    from app.routes.admin import admin_bp

    app.register_blueprint(public_bp)
    app.register_blueprint(admin_bp)

    @app.errorhandler(413)
    def file_too_large(error):

        return render_template(
            "file_too_large.html"
        ), 413

    return app