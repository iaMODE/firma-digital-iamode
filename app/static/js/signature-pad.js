const signatureModal = document.getElementById("signatureModal");
const openSignatureBtn = document.getElementById("openSignatureBtn");
const closeSignatureBtn = document.getElementById("closeSignatureBtn");
const clearSignatureBtn = document.getElementById("clearSignatureBtn");
const useSignatureBtn = document.getElementById("useSignatureBtn");
const signatureCanvas = document.getElementById("signatureCanvas");
const signatureCtx = signatureCanvas.getContext("2d");

let drawing = false;
let signatureColor = window.IAMODE_SIGNATURE_COLOR || "#1d4ed8";
let documentFinalized = false;

function setupCanvas() {
    const rect = signatureCanvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    signatureCanvas.width = rect.width * ratio;
    signatureCanvas.height = rect.height * ratio;

    signatureCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    signatureCtx.lineCap = "round";
    signatureCtx.lineJoin = "round";
    signatureCtx.strokeStyle = signatureColor;
    signatureCtx.lineWidth = 4;
}

function openSignatureModal() {
    if (documentFinalized) return;

    signatureModal.classList.remove("hidden");

    setTimeout(() => {
        setupCanvas();
    }, 50);
}

function closeSignatureModal() {
    signatureModal.classList.add("hidden");
}

function clearSignature() {
    const rect = signatureCanvas.getBoundingClientRect();

    signatureCtx.clearRect(0, 0, rect.width, rect.height);
    signatureCtx.strokeStyle = signatureColor;
}

function getPosition(event) {
    const rect = signatureCanvas.getBoundingClientRect();

    if (event.touches && event.touches.length > 0) {
        return {
            x: event.touches[0].clientX - rect.left,
            y: event.touches[0].clientY - rect.top
        };
    }

    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}

function pointerPosition(event) {
    if (event.touches && event.touches.length > 0) {
        return {
            x: event.touches[0].clientX,
            y: event.touches[0].clientY
        };
    }

    return {
        x: event.clientX,
        y: event.clientY
    };
}

function startDrawing(event) {
    if (documentFinalized) return;

    event.preventDefault();
    drawing = true;

    const pos = getPosition(event);

    signatureCtx.beginPath();
    signatureCtx.moveTo(pos.x, pos.y);
}

function draw(event) {
    if (!drawing || documentFinalized) return;

    event.preventDefault();

    const pos = getPosition(event);

    signatureCtx.lineTo(pos.x, pos.y);
    signatureCtx.stroke();
}

function stopDrawing(event) {
    if (event) {
        event.preventDefault();
    }

    drawing = false;
}

function getCurrentVisiblePdfPage() {
    const pages = document.querySelectorAll(".pdf-page-wrapper");

    let selectedPage = null;
    let smallestDistance = Infinity;

    pages.forEach((page) => {
        const rect = page.getBoundingClientRect();
        const viewportMiddle = window.innerHeight / 2;
        const pageMiddle = rect.top + rect.height / 2;
        const distance = Math.abs(pageMiddle - viewportMiddle);

        if (distance < smallestDistance) {
            smallestDistance = distance;
            selectedPage = page;
        }
    });

    return selectedPage;
}

function getPageUnderPointer(x, y) {
    const pages = document.querySelectorAll(".pdf-page-wrapper");

    for (const page of pages) {
        const rect = page.getBoundingClientRect();

        if (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
        ) {
            return page;
        }
    }

    return null;
}

function saveSignatureState(signatureBox) {
    const parent = signatureBox.parentElement;
    const signatureImg = signatureBox.querySelector("img");

    if (!parent || !signatureImg) return;

    const parentWidth = parent.offsetWidth;
    const parentHeight = parent.offsetHeight;

    const leftPx = parseFloat(signatureBox.style.left) || 0;
    const topPx = parseFloat(signatureBox.style.top) || 0;

    signatureBox.dataset.leftPercent = leftPx / parentWidth;
    signatureBox.dataset.topPercent = topPx / parentHeight;
    signatureBox.dataset.widthPercent = signatureImg.offsetWidth / parentWidth;
}

function restoreSignatureStates() {
    document.querySelectorAll(".placed-signature-box").forEach((signatureBox) => {
        const parent = signatureBox.parentElement;
        const signatureImg = signatureBox.querySelector("img");

        if (!parent || !signatureImg) return;

        const leftPercent = parseFloat(signatureBox.dataset.leftPercent);
        const topPercent = parseFloat(signatureBox.dataset.topPercent);
        const widthPercent = parseFloat(signatureBox.dataset.widthPercent);

        if (!Number.isNaN(leftPercent)) {
            signatureBox.style.left = `${leftPercent * parent.offsetWidth}px`;
        }

        if (!Number.isNaN(topPercent)) {
            signatureBox.style.top = `${topPercent * parent.offsetHeight}px`;
        }

        if (!Number.isNaN(widthPercent)) {
            signatureImg.style.width = `${widthPercent * parent.offsetWidth}px`;
        }

        signatureBox.style.transform = "none";
    });
}

window.addEventListener("resize", () => {
    setTimeout(restoreSignatureStates, 80);
});

function makeSignatureEditable(signatureBox) {
    let isDragging = false;
    let isResizing = false;

    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let initialWidth = 0;

    const deleteBtn = signatureBox.querySelector(".signature-delete");
    const resizeHandle = signatureBox.querySelector(".signature-resize-handle");
    const signatureImg = signatureBox.querySelector("img");

    function activateSignature() {
        if (documentFinalized) return;

        document.querySelectorAll(".placed-signature-box").forEach((box) => {
            if (box !== signatureBox) {
                box.classList.remove("active-signature");
            }
        });

        signatureBox.classList.add("active-signature");
    }

    function startDrag(event) {
        if (documentFinalized) return;

        if (
            event.target.classList.contains("signature-control") ||
            event.target.classList.contains("signature-resize-handle")
        ) {
            return;
        }

        event.preventDefault();
        activateSignature();

        isDragging = true;

        const pos = pointerPosition(event);
        const rect = signatureBox.getBoundingClientRect();
        const parentRect = signatureBox.parentElement.getBoundingClientRect();

        startX = pos.x;
        startY = pos.y;
        initialLeft = rect.left - parentRect.left;
        initialTop = rect.top - parentRect.top;
    }

    function moveDrag(event) {
        if (!isDragging || documentFinalized) return;

        event.preventDefault();

        const pos = pointerPosition(event);
        const currentPage = getPageUnderPointer(pos.x, pos.y);

        if (currentPage && currentPage !== signatureBox.parentElement) {
            const oldRect = signatureBox.getBoundingClientRect();
            const newParentRect = currentPage.getBoundingClientRect();

            currentPage.style.position = "relative";
            currentPage.appendChild(signatureBox);

            signatureBox.style.left = `${oldRect.left - newParentRect.left}px`;
            signatureBox.style.top = `${oldRect.top - newParentRect.top}px`;
            signatureBox.style.transform = "none";

            initialLeft = oldRect.left - newParentRect.left;
            initialTop = oldRect.top - newParentRect.top;
            startX = pos.x;
            startY = pos.y;

            saveSignatureState(signatureBox);
        }

        const parentRect = signatureBox.parentElement.getBoundingClientRect();

        let newLeft = initialLeft + (pos.x - startX);
        let newTop = initialTop + (pos.y - startY);

        newLeft = Math.max(0, Math.min(newLeft, parentRect.width - signatureBox.offsetWidth));
        newTop = Math.max(0, Math.min(newTop, parentRect.height - signatureBox.offsetHeight));

        signatureBox.style.left = `${newLeft}px`;
        signatureBox.style.top = `${newTop}px`;
        signatureBox.style.transform = "none";

        saveSignatureState(signatureBox);
    }

    function stopDrag() {
        isDragging = false;
        isResizing = false;
        saveSignatureState(signatureBox);
    }

    function startResize(event) {
        if (documentFinalized) return;

        event.preventDefault();
        event.stopPropagation();
        activateSignature();

        isResizing = true;

        const pos = pointerPosition(event);

        startX = pos.x;
        startY = pos.y;
        initialWidth = signatureImg.offsetWidth;
    }

    function moveResize(event) {
        if (!isResizing || documentFinalized) return;

        event.preventDefault();

        const pos = pointerPosition(event);
        const movement = pos.x - startX;
        const newWidth = Math.max(90, Math.min(520, initialWidth + movement));

        signatureImg.style.width = `${newWidth}px`;

        saveSignatureState(signatureBox);
    }

    deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();

        if (documentFinalized) return;

        signatureBox.remove();
    });

    resizeHandle.addEventListener("mousedown", startResize);
    resizeHandle.addEventListener("touchstart", startResize, { passive: false });

    signatureBox.addEventListener("mousedown", startDrag);

    document.addEventListener("mousemove", (event) => {
        moveDrag(event);
        moveResize(event);
    });

    document.addEventListener("mouseup", stopDrag);

    signatureBox.addEventListener("touchstart", startDrag, { passive: false });

    document.addEventListener("touchmove", (event) => {
        moveDrag(event);
        moveResize(event);
    }, { passive: false });

    document.addEventListener("touchend", stopDrag);

    signatureBox.addEventListener("click", (event) => {
        event.stopPropagation();
        activateSignature();
    });
}

function placeSignatureOnPdf() {
    if (documentFinalized) return;

    const dataUrl = signatureCanvas.toDataURL("image/png");
    const currentPage = getCurrentVisiblePdfPage();

    if (!currentPage) return;

    currentPage.style.position = "relative";

    const signatureBox = document.createElement("div");
    signatureBox.className = "placed-signature-box active-signature";

    signatureBox.innerHTML = `
        <button type="button" class="signature-control signature-delete">×</button>
        <img src="${dataUrl}" alt="Firma" class="placed-signature">
        <span class="signature-resize-handle"></span>
    `;

    currentPage.appendChild(signatureBox);

    const signatureImg = signatureBox.querySelector("img");
    signatureImg.style.width = `${currentPage.offsetWidth * 0.22}px`;

    signatureBox.style.left = `${currentPage.offsetWidth * 0.50 - signatureBox.offsetWidth / 2}px`;
    signatureBox.style.top = `${currentPage.offsetHeight * 0.72 - signatureBox.offsetHeight / 2}px`;
    signatureBox.style.transform = "none";

    makeSignatureEditable(signatureBox);
    saveSignatureState(signatureBox);
    closeSignatureModal();
}

function lockPlacedSignatures() {
    document.querySelectorAll(".placed-signature-box").forEach((signatureBox) => {
        saveSignatureState(signatureBox);

        signatureBox.classList.remove("active-signature");
        signatureBox.classList.add("finalized-signature");

        const deleteBtn = signatureBox.querySelector(".signature-delete");
        const resizeHandle = signatureBox.querySelector(".signature-resize-handle");

        if (deleteBtn) {
            deleteBtn.style.display = "none";
        }

        if (resizeHandle) {
            resizeHandle.style.display = "none";
        }

        signatureBox.style.pointerEvents = "none";
        signatureBox.style.cursor = "default";
    });
}

document.addEventListener("click", () => {
    if (documentFinalized) return;

    document.querySelectorAll(".placed-signature-box").forEach((box) => {
        box.classList.remove("active-signature");
    });
});

openSignatureBtn.addEventListener("click", openSignatureModal);
closeSignatureBtn.addEventListener("click", closeSignatureModal);
clearSignatureBtn.addEventListener("click", clearSignature);
useSignatureBtn.addEventListener("click", placeSignatureOnPdf);

signatureCanvas.addEventListener("mousedown", startDrawing);
signatureCanvas.addEventListener("mousemove", draw);
signatureCanvas.addEventListener("mouseup", stopDrawing);
signatureCanvas.addEventListener("mouseleave", stopDrawing);

signatureCanvas.addEventListener("touchstart", startDrawing, { passive: false });
signatureCanvas.addEventListener("touchmove", draw, { passive: false });
signatureCanvas.addEventListener("touchend", stopDrawing, { passive: false });

const finishSignatureBtn = document.getElementById("finishSignatureBtn");

const statusModal = document.getElementById("statusModal");
const statusModalTitle = document.getElementById("statusModalTitle");
const statusModalMessage = document.getElementById("statusModalMessage");
const closeStatusModalBtn = document.getElementById("closeStatusModalBtn");
const acceptStatusModalBtn = document.getElementById("acceptStatusModalBtn");

function showStatusModal(title, message) {
    statusModalTitle.textContent = title;
    statusModalMessage.textContent = message;

    statusModal.classList.remove("hidden");
}

function closeStatusModal() {
    statusModal.classList.add("hidden");
}

closeStatusModalBtn.addEventListener("click", closeStatusModal);
acceptStatusModalBtn.addEventListener("click", closeStatusModal);

async function finalizeDocument() {
    const signatures = document.querySelectorAll(".placed-signature-box");
    const isRemoteMode = window.IAMODE_REMOTE_MODE === true;
    const fdCode = window.IAMODE_FD_CODE || "";

    if (signatures.length === 0) {
        showStatusModal(
            "Firma requerida",
            "Debes colocar al menos una firma antes de finalizar."
        );
        return;
    }

    if (!isRemoteMode && !pdfInput.files[0]) {
        showStatusModal(
            "PDF no encontrado",
            "No se encontró el PDF que deseas firmar."
        );
        return;
    }

    finishSignatureBtn.disabled = true;
    finishSignatureBtn.textContent = "Generando PDF...";

    try {
        const payload = [];

        document.querySelectorAll(".placed-signature-box").forEach((signatureBox) => {
            saveSignatureState(signatureBox);

            const signatureImg = signatureBox.querySelector("img");
            const pageWrapper = signatureBox.parentElement;
            const pageCanvas = pageWrapper.querySelector(".pdf-page");

            const pageIndex = Array.from(
                document.querySelectorAll(".pdf-page-wrapper")
            ).indexOf(pageWrapper);

            const signatureRect = signatureImg.getBoundingClientRect();
            const canvasRect = pageCanvas.getBoundingClientRect();

            payload.push({
                page: pageIndex + 1,
                image: signatureImg.src,
                leftPercent: (signatureRect.left - canvasRect.left) / canvasRect.width,
                topPercent: (signatureRect.top - canvasRect.top) / canvasRect.height,
                widthPercent: signatureRect.width / canvasRect.width
            });
        });

        documentFinalized = true;
        lockPlacedSignatures();

        openSignatureBtn.disabled = true;

        if (clearPdfBtn) {
            clearPdfBtn.disabled = true;
        }

        const formData = new FormData();

        if (isRemoteMode) {
            formData.append("fd_code", fdCode);
        } else {
            formData.append("pdf", pdfInput.files[0]);
        }

        formData.append("signatures", JSON.stringify(payload));

        const response = await fetch("/api/finalize", {
            method: "POST",
            body: formData
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || "No se pudo generar el PDF.");
        }

        finishSignatureBtn.textContent = "PDF Generado";
        finishSignatureBtn.classList.add("finished");

        window.location.href = result.redirect_url;

    } catch (error) {
        console.error(error);

        documentFinalized = false;

        finishSignatureBtn.disabled = false;
        finishSignatureBtn.textContent = "Finalizar";

        openSignatureBtn.disabled = false;

        if (clearPdfBtn) {
            clearPdfBtn.disabled = false;
        }

        showStatusModal(
            "No fue posible finalizar",
            error.message || "Ocurrió un error."
        );
    }
}

finishSignatureBtn.addEventListener("click", finalizeDocument);