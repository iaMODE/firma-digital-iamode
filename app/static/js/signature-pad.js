const signatureModal = document.getElementById("signatureModal");
const openSignatureBtn = document.getElementById("openSignatureBtn");
const closeSignatureBtn = document.getElementById("closeSignatureBtn");
const clearSignatureBtn = document.getElementById("clearSignatureBtn");
const useSignatureBtn = document.getElementById("useSignatureBtn");
const signatureCanvas = document.getElementById("signatureCanvas");
const signatureCtx = signatureCanvas.getContext("2d");

const drawSignatureModeBtn = document.getElementById("drawSignatureModeBtn");
const photoSignatureModeBtn = document.getElementById("photoSignatureModeBtn");
const drawSignatureWrap = document.getElementById("drawSignatureWrap");
const photoSignatureWrap = document.getElementById("photoSignatureWrap");
const signaturePhotoInput = document.getElementById("signaturePhotoInput");
const signaturePhotoPreviewWrap = document.getElementById("signaturePhotoPreviewWrap");
const signaturePhotoPreview = document.getElementById("signaturePhotoPreview");
const signaturePhotoDropzone = document.querySelector(".signature-photo-dropzone");

const signatureCropModal = document.getElementById("signatureCropModal");
const closeSignatureCropBtn = document.getElementById("closeSignatureCropBtn");
const cancelSignatureCropBtn = document.getElementById("cancelSignatureCropBtn");
const useSignatureCropBtn = document.getElementById("useSignatureCropBtn");
const signatureCropStage = document.getElementById("signatureCropStage");
const signatureCropImage = document.getElementById("signatureCropImage");
const signatureCropBox = document.getElementById("signatureCropBox");

let drawing = false;
let signatureColor = window.IAMODE_SIGNATURE_COLOR || "#1d4ed8";
let documentFinalized = false;
let currentSignatureMode = "draw";
let signaturePhotoDataUrl = null;
let rawSignaturePhotoDataUrl = null;

function isMobileViewport() {
    return window.innerWidth <= 768;
}

function getSignatureStrokeWidth() {
    return isMobileViewport() ? 2.2 : 2.6;
}

function getInitialSignatureWidth(pageWidth) {
    if (isMobileViewport()) {
        return Math.max(52, Math.min(90, pageWidth * 0.14));
    }

    return Math.max(120, Math.min(220, pageWidth * 0.22));
}

function getMinSignatureWidth() {
    return isMobileViewport() ? 18 : 32;
}

function getMaxSignatureWidth(pageWidth) {
    return Math.max(220, pageWidth * 0.70);
}

function setupCanvas() {
    const rect = signatureCanvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    signatureCanvas.width = rect.width * ratio;
    signatureCanvas.height = rect.height * ratio;

    signatureCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    signatureCtx.lineCap = "round";
    signatureCtx.lineJoin = "round";
    signatureCtx.strokeStyle = signatureColor;
    signatureCtx.lineWidth = getSignatureStrokeWidth();
}

function setSignatureMode(mode) {
    currentSignatureMode = mode;

    if (mode === "draw") {
        drawSignatureWrap.classList.remove("hidden");
        photoSignatureWrap.classList.add("hidden");

        drawSignatureModeBtn.classList.add("active-sign-mode");
        photoSignatureModeBtn.classList.remove("active-sign-mode");

        setTimeout(() => {
            setupCanvas();
        }, 50);

        return;
    }

    drawSignatureWrap.classList.add("hidden");
    photoSignatureWrap.classList.remove("hidden");

    drawSignatureModeBtn.classList.remove("active-sign-mode");
    photoSignatureModeBtn.classList.add("active-sign-mode");
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
    signatureCtx.lineWidth = getSignatureStrokeWidth();

    signaturePhotoDataUrl = null;
    rawSignaturePhotoDataUrl = null;

    if (signaturePhotoInput) {
        signaturePhotoInput.value = "";
    }

    if (signaturePhotoPreview) {
        signaturePhotoPreview.removeAttribute("src");
    }

    if (signaturePhotoPreviewWrap) {
        signaturePhotoPreviewWrap.classList.add("hidden");
    }

    if (signaturePhotoDropzone) {
        signaturePhotoDropzone.classList.remove("hidden");
    }
}

function cropTransparentCanvas(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    let top = height;
    let left = width;
    let right = 0;
    let bottom = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            const alpha = data[index + 3];

            if (alpha > 20) {
                top = Math.min(top, y);
                left = Math.min(left, x);
                right = Math.max(right, x);
                bottom = Math.max(bottom, y);
            }
        }
    }

    if (right <= left || bottom <= top) {
        return canvas;
    }

    const padding = 8;

    left = Math.max(0, left - padding);
    top = Math.max(0, top - padding);
    right = Math.min(width - 1, right + padding);
    bottom = Math.min(height - 1, bottom + padding);

    const trimmedWidth = right - left + 1;
    const trimmedHeight = bottom - top + 1;

    const trimmedCanvas = document.createElement("canvas");
    trimmedCanvas.width = trimmedWidth;
    trimmedCanvas.height = trimmedHeight;

    trimmedCanvas
        .getContext("2d")
        .drawImage(
            canvas,
            left,
            top,
            trimmedWidth,
            trimmedHeight,
            0,
            0,
            trimmedWidth,
            trimmedHeight
        );

    return trimmedCanvas;
}

function processSignaturePhotoDataUrl(dataUrl) {
    if (!dataUrl) return;

    const img = new Image();

    img.onload = () => {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // ======================================================
       // LIMPIEZA PREVIA DE SOMBRAS SUAVES
      // ======================================================

      for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          const brightness = (r + g + b) / 3;
          const contrast = Math.max(r, g, b) - Math.min(r, g, b);

          // elimina sombras suaves/grises
          if (
              brightness > 125 &&
              brightness < 235 &&
              contrast < 18
          ) {
              data[i] = 255;
              data[i + 1] = 255;
              data[i + 2] = 255;
          }
        }

        const inkR = parseInt(signatureColor.slice(1, 3), 16);
        const inkG = parseInt(signatureColor.slice(3, 5), 16);
        const inkB = parseInt(signatureColor.slice(5, 7), 16);

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const brightness = (r + g + b) / 3;
            const contrast = max - min;

            const blueInkScore = b - Math.max(r, g);
            const darknessScore = 255 - brightness;

            const isStrongBlueInk =
                blueInkScore > 8 &&
                darknessScore > 36 &&
                contrast > 18;

            const isStrongDarkInk =
                darknessScore > 72 &&
                contrast > 12;

            const isLikelyInk = isStrongBlueInk || isStrongDarkInk;

            if (!isLikelyInk) {
                data[i + 3] = 0;
                continue;
            }

            let alpha = Math.max(
                darknessScore * 2.7,
                blueInkScore * 8
            );

            alpha = Math.max(0, Math.min(255, alpha));

            if (alpha < 140) {
                data[i + 3] = 0;
                continue;
            }

            data[i] = inkR;
            data[i + 1] = inkG;
            data[i + 2] = inkB;
            data[i + 3] = alpha;
        }

        ctx.putImageData(imageData, 0, 0);

        const trimmedCanvas = cropTransparentCanvas(canvas);
        signaturePhotoDataUrl = trimmedCanvas.toDataURL("image/png");

        signaturePhotoPreview.src = signaturePhotoDataUrl;
        signaturePhotoPreviewWrap.classList.remove("hidden");

        if (signaturePhotoDropzone) {
            signaturePhotoDropzone.classList.add("hidden");
        }
    };

    img.src = dataUrl;
}

function openSignatureCropModal(dataUrl) {
    if (!signatureCropModal || !signatureCropImage || !signatureCropBox) {
        processSignaturePhotoDataUrl(dataUrl);
        return;
    }

    rawSignaturePhotoDataUrl = dataUrl;
    signatureCropImage.src = dataUrl;
    signatureCropModal.classList.remove("hidden");

    signatureCropImage.onload = () => {
        setTimeout(() => {
            const stageRect = signatureCropStage.getBoundingClientRect();
            const boxWidth = Math.min(360, stageRect.width * 0.72);
            const boxHeight = Math.min(170, stageRect.height * 0.38);

            signatureCropBox.style.width = `${boxWidth}px`;
            signatureCropBox.style.height = `${boxHeight}px`;
            signatureCropBox.style.left = `${(stageRect.width - boxWidth) / 2}px`;
            signatureCropBox.style.top = `${(stageRect.height - boxHeight) / 2}px`;
        }, 80);
    };
}

function closeSignatureCropModal() {
    if (signatureCropModal) {
        signatureCropModal.classList.add("hidden");
    }
}

function processSelectedCrop() {
    if (!rawSignaturePhotoDataUrl || !signatureCropImage || !signatureCropBox) return;

    const img = new Image();

    img.onload = () => {
        const imageRect = signatureCropImage.getBoundingClientRect();
        const boxRect = signatureCropBox.getBoundingClientRect();

        const scaleX = img.width / imageRect.width;
        const scaleY = img.height / imageRect.height;

        let sourceX = (boxRect.left - imageRect.left) * scaleX;
        let sourceY = (boxRect.top - imageRect.top) * scaleY;
        let sourceWidth = boxRect.width * scaleX;
        let sourceHeight = boxRect.height * scaleY;

        sourceX = Math.max(0, Math.min(sourceX, img.width - 1));
        sourceY = Math.max(0, Math.min(sourceY, img.height - 1));
        sourceWidth = Math.max(1, Math.min(sourceWidth, img.width - sourceX));
        sourceHeight = Math.max(1, Math.min(sourceHeight, img.height - sourceY));

        const cropCanvas = document.createElement("canvas");
        const cropCtx = cropCanvas.getContext("2d");

        cropCanvas.width = Math.round(sourceWidth);
        cropCanvas.height = Math.round(sourceHeight);

        cropCtx.drawImage(
            img,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            cropCanvas.width,
            cropCanvas.height
        );

        closeSignatureCropModal();
        processSignaturePhotoDataUrl(cropCanvas.toDataURL("image/png"));
    };

    img.src = rawSignaturePhotoDataUrl;
}

function processSignaturePhoto(file) {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
        setSignatureMode("photo");
        openSignatureCropModal(event.target.result);
    };

    reader.readAsDataURL(file);
}

function setupCropEditor() {
    if (!signatureCropStage || !signatureCropBox) return;

    let action = null;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let initialWidth = 0;
    let initialHeight = 0;

    function getPointer(event) {
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

    function clampBox(left, top, width, height) {
        const stageRect = signatureCropStage.getBoundingClientRect();
        const minWidth = 80;
        const minHeight = 45;

        width = Math.max(minWidth, Math.min(width, stageRect.width));
        height = Math.max(minHeight, Math.min(height, stageRect.height));

        left = Math.max(0, Math.min(left, stageRect.width - width));
        top = Math.max(0, Math.min(top, stageRect.height - height));

        signatureCropBox.style.left = `${left}px`;
        signatureCropBox.style.top = `${top}px`;
        signatureCropBox.style.width = `${width}px`;
        signatureCropBox.style.height = `${height}px`;
    }

    function startCropAction(event) {
        if (documentFinalized) return;

        event.preventDefault();
        event.stopPropagation();

        const target = event.target;
        const pos = getPointer(event);

        if (target.classList.contains("crop-handle-tl")) {
            action = "resize-tl";
        } else if (target.classList.contains("crop-handle-tr")) {
            action = "resize-tr";
        } else if (target.classList.contains("crop-handle-bl")) {
            action = "resize-bl";
        } else if (target.classList.contains("crop-handle-br")) {
            action = "resize-br";
        } else {
            action = "move";
        }

        startX = pos.x;
        startY = pos.y;
        initialLeft = parseFloat(signatureCropBox.style.left) || 0;
        initialTop = parseFloat(signatureCropBox.style.top) || 0;
        initialWidth = signatureCropBox.offsetWidth;
        initialHeight = signatureCropBox.offsetHeight;
    }

    function moveCropAction(event) {
        if (!action) return;

        event.preventDefault();

        const pos = getPointer(event);
        const dx = pos.x - startX;
        const dy = pos.y - startY;

        let newLeft = initialLeft;
        let newTop = initialTop;
        let newWidth = initialWidth;
        let newHeight = initialHeight;

        if (action === "move") {
            newLeft = initialLeft + dx;
            newTop = initialTop + dy;
        }

        if (action === "resize-br") {
            newWidth = initialWidth + dx;
            newHeight = initialHeight + dy;
        }

        if (action === "resize-bl") {
            newLeft = initialLeft + dx;
            newWidth = initialWidth - dx;
            newHeight = initialHeight + dy;
        }

        if (action === "resize-tr") {
            newTop = initialTop + dy;
            newWidth = initialWidth + dx;
            newHeight = initialHeight - dy;
        }

        if (action === "resize-tl") {
            newLeft = initialLeft + dx;
            newTop = initialTop + dy;
            newWidth = initialWidth - dx;
            newHeight = initialHeight - dy;
        }

        clampBox(newLeft, newTop, newWidth, newHeight);
    }

    function stopCropAction() {
        action = null;
    }

    signatureCropBox.addEventListener("mousedown", startCropAction);
    signatureCropBox.addEventListener("touchstart", startCropAction, { passive: false });

    document.addEventListener("mousemove", moveCropAction);
    document.addEventListener("touchmove", moveCropAction, { passive: false });

    document.addEventListener("mouseup", stopCropAction);
    document.addEventListener("touchend", stopCropAction);
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
    if (documentFinalized || currentSignatureMode !== "draw") return;

    event.preventDefault();
    drawing = true;

    const pos = getPosition(event);

    signatureCtx.beginPath();
    signatureCtx.moveTo(pos.x, pos.y);
}

function draw(event) {
    if (!drawing || documentFinalized || currentSignatureMode !== "draw") return;

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

function applySignatureRotation(signatureBox) {
    const rotation = parseFloat(signatureBox.dataset.rotation || "0");
    signatureBox.style.transform = `rotate(${rotation}deg)`;
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

    if (!signatureBox.dataset.rotation) {
        signatureBox.dataset.rotation = "0";
    }
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
            signatureImg.style.height = "auto";
        }

        applySignatureRotation(signatureBox);
    });
}

window.addEventListener("resize", () => {
    setTimeout(restoreSignatureStates, 80);
});

function makeSignatureEditable(signatureBox) {
    let isDragging = false;
    let isResizing = false;
    let isRotating = false;

    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let initialWidth = 0;
    let initialRotation = 0;

    const deleteBtn = signatureBox.querySelector(".signature-delete");
    const resizeHandle = signatureBox.querySelector(".signature-resize-handle");
    const rotateBtn = signatureBox.querySelector(".signature-rotate");
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

    function getCenterPoint() {
        const rect = signatureBox.getBoundingClientRect();

        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }

    function getAngleFromCenter(pos) {
        const center = getCenterPoint();

        return Math.atan2(pos.y - center.y, pos.x - center.x) * 180 / Math.PI;
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

            applySignatureRotation(signatureBox);

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

        applySignatureRotation(signatureBox);
        saveSignatureState(signatureBox);
    }

    function stopPointerAction() {
        isDragging = false;
        isResizing = false;
        isRotating = false;
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
        const parentWidth = signatureBox.parentElement.offsetWidth;

        const minWidth = getMinSignatureWidth();
        const maxWidth = getMaxSignatureWidth(parentWidth);
        const newWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth + movement));

        signatureImg.style.width = `${newWidth}px`;
        signatureImg.style.height = "auto";

        applySignatureRotation(signatureBox);
        saveSignatureState(signatureBox);
    }

    function startRotate(event) {
        if (documentFinalized) return;

        event.preventDefault();
        event.stopPropagation();
        activateSignature();

        isRotating = true;

        const pos = pointerPosition(event);

        startX = getAngleFromCenter(pos);
        initialRotation = parseFloat(signatureBox.dataset.rotation || "0");
    }

    function moveRotate(event) {
        if (!isRotating || documentFinalized) return;

        event.preventDefault();

        const pos = pointerPosition(event);
        const currentAngle = getAngleFromCenter(pos);
        const newRotation = initialRotation + (currentAngle - startX);

        signatureBox.dataset.rotation = String(newRotation);
        applySignatureRotation(signatureBox);
        saveSignatureState(signatureBox);
    }

    deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();

        if (documentFinalized) return;

        signatureBox.remove();
    });

    resizeHandle.addEventListener("mousedown", startResize);
    resizeHandle.addEventListener("touchstart", startResize, { passive: false });

    if (rotateBtn) {
        rotateBtn.addEventListener("mousedown", startRotate);
        rotateBtn.addEventListener("touchstart", startRotate, { passive: false });
    }

    signatureBox.addEventListener("mousedown", startDrag);

    document.addEventListener("mousemove", (event) => {
        moveDrag(event);
        moveResize(event);
        moveRotate(event);
    });

    document.addEventListener("mouseup", stopPointerAction);

    signatureBox.addEventListener("touchstart", startDrag, { passive: false });

    document.addEventListener("touchmove", (event) => {
        moveDrag(event);
        moveResize(event);
        moveRotate(event);
    }, { passive: false });

    document.addEventListener("touchend", stopPointerAction);

    signatureBox.addEventListener("click", (event) => {
        event.stopPropagation();
        activateSignature();
    });
}

function placeSignatureOnPdf() {
    if (documentFinalized) return;

    let dataUrl = null;

    if (currentSignatureMode === "photo") {
        dataUrl = signaturePhotoDataUrl;
    } else {
        dataUrl = signatureCanvas.toDataURL("image/png");
    }

    if (!dataUrl) {
        return;
    }

    const currentPage = getCurrentVisiblePdfPage();

    if (!currentPage) return;

    currentPage.style.position = "relative";

    const signatureBox = document.createElement("div");
    signatureBox.className = "placed-signature-box active-signature";
    signatureBox.dataset.rotation = "0";

    signatureBox.innerHTML = `
        <button type="button" class="signature-control signature-delete">×</button>
        <button type="button" class="signature-control signature-rotate">↻</button>
        <img src="${dataUrl}" alt="Firma" class="placed-signature">
        <span class="signature-resize-handle"></span>
    `;

    currentPage.appendChild(signatureBox);

    const signatureImg = signatureBox.querySelector("img");
    signatureImg.style.width = `${getInitialSignatureWidth(currentPage.offsetWidth)}px`;
    signatureImg.style.height = "auto";

    signatureBox.style.left = `${currentPage.offsetWidth * 0.50 - signatureBox.offsetWidth / 2}px`;
    signatureBox.style.top = `${currentPage.offsetHeight * 0.56 - signatureBox.offsetHeight / 2}px`;

    applySignatureRotation(signatureBox);

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
        const rotateBtn = signatureBox.querySelector(".signature-rotate");

        if (deleteBtn) {
            deleteBtn.style.display = "none";
        }

        if (resizeHandle) {
            resizeHandle.style.display = "none";
        }

        if (rotateBtn) {
            rotateBtn.style.display = "none";
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

if (drawSignatureModeBtn) {
    drawSignatureModeBtn.addEventListener("click", () => {
        setSignatureMode("draw");
    });
}

if (photoSignatureModeBtn) {
    photoSignatureModeBtn.addEventListener("click", () => {
        setSignatureMode("photo");
    });
}

if (signaturePhotoInput) {
    signaturePhotoInput.addEventListener("change", (event) => {
        const file = event.target.files && event.target.files[0];

        if (!file) return;

        setSignatureMode("photo");
        processSignaturePhoto(file);
    });
}

if (closeSignatureCropBtn) {
    closeSignatureCropBtn.addEventListener("click", closeSignatureCropModal);
}

if (cancelSignatureCropBtn) {
    cancelSignatureCropBtn.addEventListener("click", closeSignatureCropModal);
}

if (useSignatureCropBtn) {
    useSignatureCropBtn.addEventListener("click", processSelectedCrop);
}

setupCropEditor();

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
                widthPercent: signatureRect.width / canvasRect.width,
                rotation: parseFloat(signatureBox.dataset.rotation || "0")
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