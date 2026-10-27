(() => {
    const dialog = document.getElementById("qrScannerDialog");
    const openButton = document.getElementById("scanQrButton");
    if (!dialog || !openButton) return;

    const closeButton = document.getElementById("closeScannerButton");
    const startButton = document.getElementById("startCameraButton");
    const switchButton = document.getElementById("switchCameraButton");
    const torchButton = document.getElementById("torchButton");
    const imageInput = document.getElementById("qrImageInput");
    const video = document.getElementById("qrScannerVideo");
    const scannerView = document.getElementById("scannerView");
    const resultView = document.getElementById("scannerResult");
    const status = document.getElementById("scannerStatus");
    const resultTitle = document.getElementById("scannerResultTitle");
    const resultCopy = document.getElementById("scannerResultCopy");
    const openQrLink = document.getElementById("openScannedQrLink");
    const scanAgainButton = document.getElementById("scanAgainButton");

    let codeReader = null;
    let scannerControls = null;
    let resultLocked = false;
    let videoInputs = [];
    let cameraIndex = 0;
    let torchOn = false;
    const QR_ROUTES = Object.freeze({
        "299az81a68c": 1,
        "hq1bq8pg1c": 2,
        "iq1bz5iutx": 3,
        "qrxc7ij88f": 4,
        "eq4bunq5v": 5,
        "jk1ba63db": 6
    });
    const STORY_QR_ROUTES = Object.freeze({
        "bs001-01": 1,
        "bs001-02": 2,
        "bs001-03": 3,
        "bs001-04": 4,
        "bs001-05": 5,
        "bs001-06": 6
    });

    function setStatus(message) {
        status.textContent = message;
    }

    function stopCamera() {
        try {
            scannerControls?.stop();
        } catch (error) {
            console.warn("QR 카메라 종료 중 오류", error);
        }
        scannerControls = null;
        const stream = video.srcObject;
        stream?.getTracks?.().forEach((track) => track.stop());
        video.srcObject = null;
        torchOn = false;
        torchButton.hidden = true;
        torchButton.textContent = "손전등 켜기";
    }

    function parseDoktoriQr(rawValue) {
        const value = String(rawValue || "").trim();
        if (!value) return null;

        let parsed;
        try {
            parsed = new URL(value, location.href);
        } catch {
            return null;
        }

        const trustedOrigins = new Set([location.origin, "https://bokseong.github.io"]);
        if (!trustedOrigins.has(parsed.origin)) return null;

        const match = parsed.pathname.match(/^\/(?:doktori\/)?qr\/(story\/)?([a-z0-9-]+)\.html\/?$/i);
        if (!match) return null;
        const isStory = Boolean(match[1]);
        const route = match[2].toLowerCase();
        const number = (isStory ? STORY_QR_ROUTES : QR_ROUTES)[route];
        if (!number) return null;
        const normalRoute = Object.keys(QR_ROUTES).find((candidate) => QR_ROUTES[candidate] === number);
        return {
            number,
            label: `QR ${String(number).padStart(2, "0")}`,
            target: new URL(`${document.body.dataset.root || "./"}qr/${normalRoute}.html`, location.href).href
        };
    }

    function showScannerView() {
        resultLocked = false;
        scannerView.hidden = false;
        resultView.hidden = true;
        setStatus("카메라를 QR에 맞춰 주세요.");
    }

    function showResult(qr) {
        if (resultLocked) return;
        resultLocked = true;
        stopCamera();
        navigator.vibrate?.(80);
        scannerView.hidden = true;
        resultView.hidden = false;
        resultTitle.textContent = `${qr.label}을 인식했습니다`;
        resultCopy.textContent = "문제 페이지를 열면 로그인 상태를 확인한 뒤 미션을 진행합니다.";
        openQrLink.href = qr.target;
        openQrLink.focus();
    }

    function handleDecoded(rawValue) {
        const qr = parseDoktoriQr(rawValue);
        if (!qr) {
            setStatus("독토리 QR 1~6만 이용할 수 있습니다. 다른 QR을 비춰 주세요.");
            return false;
        }
        showResult(qr);
        return true;
    }

    function ensureReader() {
        if (!window.ZXingBrowser?.BrowserQRCodeReader) {
            throw new Error("QR 인식 모듈을 불러오지 못했습니다.");
        }
        codeReader ||= new window.ZXingBrowser.BrowserQRCodeReader(undefined, {
            delayBetweenScanAttempts: 180,
            delayBetweenScanSuccess: 800
        });
        return codeReader;
    }

    async function refreshCameraControls() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            videoInputs = devices.filter((device) => device.kind === "videoinput");
            switchButton.hidden = videoInputs.length < 2;
            const activeTrack = video.srcObject?.getVideoTracks?.()[0];
            const capabilities = activeTrack?.getCapabilities?.() || {};
            torchButton.hidden = capabilities.torch !== true;
        } catch {
            switchButton.hidden = true;
            torchButton.hidden = true;
        }
    }

    async function startCamera(deviceId = "") {
        stopCamera();
        showScannerView();
        startButton.disabled = true;

        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            setStatus("카메라는 HTTPS 주소에서만 사용할 수 있습니다. QR 이미지 선택 기능을 이용해 주세요.");
            startButton.disabled = false;
            return;
        }

        setStatus("카메라 권한을 확인하는 중입니다...");
        try {
            const reader = ensureReader();
            scannerControls = await reader.decodeFromConstraints({
                audio: false,
                video: {
                    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            }, video, (result, _error, controls) => {
                if (!result || resultLocked) return;
                scannerControls = controls;
                handleDecoded(result.getText());
            });
            await refreshCameraControls();
            const activeId = video.srcObject?.getVideoTracks?.()[0]?.getSettings?.().deviceId;
            const activeIndex = videoInputs.findIndex((device) => device.deviceId === activeId);
            if (activeIndex >= 0) cameraIndex = activeIndex;
            setStatus("QR이 네모 안에 선명하게 보이도록 맞춰 주세요.");
        } catch (error) {
            console.error(error);
            const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
            setStatus(denied
                ? "카메라 권한이 거부되었습니다. 브라우저 설정에서 허용하거나 QR 이미지를 선택해 주세요."
                : "카메라를 시작하지 못했습니다. QR 이미지 선택 기능을 이용해 주세요.");
        } finally {
            startButton.disabled = false;
        }
    }

    async function switchCamera() {
        if (videoInputs.length < 2) return;
        cameraIndex = (cameraIndex + 1) % videoInputs.length;
        await startCamera(videoInputs[cameraIndex].deviceId);
    }

    async function toggleTorch() {
        const track = video.srcObject?.getVideoTracks?.()[0];
        if (!track?.applyConstraints) return;
        try {
            torchOn = !torchOn;
            await track.applyConstraints({ advanced: [{ torch: torchOn }] });
            torchButton.textContent = torchOn ? "손전등 끄기" : "손전등 켜기";
        } catch (error) {
            torchOn = false;
            torchButton.hidden = true;
            setStatus("이 기기에서는 손전등을 제어할 수 없습니다.");
        }
    }

    async function decodeImage(file) {
        if (!file) return;
        stopCamera();
        showScannerView();
        setStatus("선택한 이미지에서 QR을 찾는 중입니다...");

        const objectUrl = URL.createObjectURL(file);
        try {
            const result = await ensureReader().decodeFromImageUrl(objectUrl);
            if (!handleDecoded(result.getText())) {
                setStatus("독토리 QR 1~6이 아닙니다. 다른 이미지를 선택해 주세요.");
            }
        } catch (error) {
            console.error(error);
            setStatus("이미지에서 QR을 찾지 못했습니다. QR이 선명한 다른 이미지를 선택해 주세요.");
        } finally {
            URL.revokeObjectURL(objectUrl);
            imageInput.value = "";
        }
    }

    function closeScanner() {
        stopCamera();
        document.body.classList.remove("scanner-open");
        if (dialog.open) dialog.close();
        openButton.focus();
    }

    function openScanner() {
        showScannerView();
        document.body.classList.add("scanner-open");
        dialog.showModal();
        startCamera();
    }

    openButton.addEventListener("click", openScanner);
    closeButton.addEventListener("click", closeScanner);
    startButton.addEventListener("click", () => startCamera());
    switchButton.addEventListener("click", switchCamera);
    torchButton.addEventListener("click", toggleTorch);
    scanAgainButton.addEventListener("click", () => startCamera());
    imageInput.addEventListener("change", () => decodeImage(imageInput.files?.[0]));
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeScanner();
    });
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeScanner();
    });
    window.addEventListener("pagehide", stopCamera);

    if (location.hash === "#scan") {
        history.replaceState(null, "", `${location.pathname}${location.search}`);
        requestAnimationFrame(openScanner);
    }
})();
