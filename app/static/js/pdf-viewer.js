const pdfInput = document.getElementById("pdfFile");
const pdfViewer = document.getElementById("pdfViewer");
const viewerPanel = document.getElementById("viewerPanel");
const uploadPanel = document.getElementById("uploadPanel");
const pdfToolbar = document.getElementById("pdfToolbar");
const pdfName = document.getElementById("pdfName");
const clearPdfBtn = document.getElementById("clearPdfBtn");

if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

let currentPdfFile = null;
let currentPdfBlob = null;

async function renderPdfFromUrl(fileUrl, displayName) {
    pdfName.textContent = displayName || "Documento PDF";
    pdfToolbar.classList.remove("hidden");
    uploadPanel.classList.add("hidden");
    viewerPanel.classList.remove("hidden");
    pdfViewer.innerHTML = "";

    try {
        const pdf = await pdfjsLib.getDocument(fileUrl).promise;

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);

            const containerWidth = pdfViewer.clientWidth - 36;
            const viewportOriginal = page.getViewport({ scale: 1 });
            const scale = containerWidth / viewportOriginal.width;
            const viewport = page.getViewport({ scale });

            const pageWrapper = document.createElement("div");
            pageWrapper.className = "pdf-page-wrapper";
            pageWrapper.dataset.page = pageNumber;

            const canvas = document.createElement("canvas");
            canvas.className = "pdf-page";
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const context = canvas.getContext("2d");

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            pageWrapper.appendChild(canvas);
            pdfViewer.appendChild(pageWrapper);
        }
    } catch (error) {
        console.error(error);
        alert("No se pudo abrir el PDF.");
    }
}

async function loadPdfFromRemoteUrl(remoteUrl) {
    try {
        const response = await fetch(remoteUrl);

        if (!response.ok) {
            throw new Error("No se pudo cargar el PDF remoto.");
        }

        const blob = await response.blob();

        currentPdfBlob = blob;
        currentPdfFile = new File(
            [blob],
            "documento-para-firmar.pdf",
            { type: "application/pdf" }
        );

        const fileUrl = URL.createObjectURL(blob);
        const remoteDisplayName = window.IAMODE_DOCUMENT_TITLE || "Documento para firmar";

        await renderPdfFromUrl(
            fileUrl,
            remoteDisplayName
        );

    } catch (error) {
        console.error(error);
        alert("No se pudo cargar el documento solicitado.");
    }
}

if (pdfInput) {
    pdfInput.addEventListener("change", async function () {
        const file = this.files[0];

        if (!file) return;

        if (file.type !== "application/pdf") {
            alert("Por favor selecciona un archivo PDF.");
            return;
        }

        currentPdfFile = file;
        currentPdfBlob = file;

        const fileUrl = URL.createObjectURL(file);

        await renderPdfFromUrl(fileUrl, file.name);
    });
}

if (clearPdfBtn) {
    clearPdfBtn.addEventListener("click", function () {
        pdfInput.value = "";
        currentPdfFile = null;
        currentPdfBlob = null;
        pdfViewer.innerHTML = "";
        pdfToolbar.classList.add("hidden");
        viewerPanel.classList.add("hidden");
        uploadPanel.classList.remove("hidden");
    });
}

document.addEventListener("DOMContentLoaded", function () {
    if (
        window.IAMODE_REMOTE_MODE === true &&
        window.IAMODE_INITIAL_PDF_URL
    ) {
        loadPdfFromRemoteUrl(window.IAMODE_INITIAL_PDF_URL);
    }
});