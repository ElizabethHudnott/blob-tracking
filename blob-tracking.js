'use strict';

const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
const offscreenCanvas = document.createElement('CANVAS');
const offscreenContext = offscreenCanvas.getContext('2d');
const displaySelector = document.getElementById('camera-display');
let targetColor = [0, 0, 0];
let keyColor = [0, 0, 0];
let sampleSize = 1;
let lastUpdate = 0;
let hueThreshold = parseFloat(document.getElementById('hue-threshold').value) / 1530;
let chromaThreshold = parseFloat(document.getElementById('chroma-threshold').value) / 255;
let lightnessThreshold = parseFloat(document.getElementById('lightness-threshold').value) / 765;
let motionThreshold = 0.1;
let videoTrack, width, height, numBytes, updatePeriod, animID, previousPixels;

const Display = Object.freeze({
	OFF: 0,
	CAM: 1,
	COLOR_KEY: 2,
	BLOBS: 3,
	MOTION_TRACKER: 4,
});

let display = Display.STOPPED;
let lastDisplay = Display.COLOR_KEY;

function showWebcam(time) {
	animID = requestAnimationFrame(showWebcam);
	if (time - lastUpdate < updatePeriod) {
		return;
	}
	let displayData;
	if (display === Display.MOTION_TRACKER) {
		displayData = context.createImageData(width, height);
	} else {
		context.drawImage(video, 0, 0);
		displayData = context.getImageData(0, 0, width, height);
	}
	offscreenContext.drawImage(video, 0, 0);

	const imageData = offscreenContext.getImageData(0, 0, width, height);
	const pixels = imageData.data;
	const displayPixels = displayData.data;

	for (let i = 0; i < numBytes; i += 4) {
		let red = pixels[i];
		let green = pixels[i + 1];
		let blue = pixels[i + 2];
		let hcl = rgbToHCL(red, green, blue);
		let colorVector = colorDifference(hcl, targetColor);
		const colorMatch = colorVector[0] <= hueThreshold && colorVector[1] <= chromaThreshold && colorVector[2] <= lightnessThreshold;

		red = previousPixels[i];
		green = previousPixels[i + 1];
		blue = previousPixels[i + 2];
		const previousColor = rgbToHCL(red, green, blue);
		colorVector = colorDifference(hcl, previousColor);
		const motionMatch = 4 * colorVector[0] * colorVector[0] + colorVector[1] * colorVector[1] + colorVector[2] * colorVector[2] >= motionThreshold;

		if (colorMatch) {
			if (display === Display.COLOR_KEY) {
				displayPixels[i] = keyColor[0];
				displayPixels[i + 1] = keyColor[1];
				displayPixels[i + 2] = keyColor[2];
			}
		}
		if (display === Display.MOTION_TRACKER) {
			displayPixels[i + 3] = motionMatch ? 0 : 255;	// Set alpha
		}
	}
	context.putImageData(displayData, 0, 0);
	previousPixels = pixels;
	lastUpdate = time;
}

async function startCam() {
	const button = document.getElementById('camera-activation');
	button.disabled = true;
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
		video.srcObject = stream;
		videoTrack = stream.getVideoTracks()[0];
		const info = videoTrack.getSettings();
		width = info.width;
		height = info.height;
		numBytes = width * height * 4;
		updatePeriod = 1000 / info.frameRate;
		canvas.width = width;
		canvas.height = height;
		offscreenCanvas.width = width;
		offscreenCanvas.height = height;
		previousPixels = new Uint8ClampedArray(numBytes);
		animID = requestAnimationFrame(showWebcam);
		display = parseInt(displaySelector.value);
		button.innerHTML = 'Stop';
	}  catch(error) {
		console.error(error);
	} finally {
		button.disabled = false;
	}
}

startCam();

function stopCam() {
	cancelAnimationFrame(animID);
	context.fillRect(0, 0, width, height);
	videoTrack.stop();
	video.srcObject = null;
	display = Display.STOPPED;
	document.getElementById('camera-activation').innerHTML = 'Start';
}

canvas.addEventListener('pointerdown', function (event) {
	if (display === Display.MOTION_TRACKER) {
		return;
	}
	if (event.button === 2) {
		display = Display.CAM;
		displaySelector.value = Display.CAM;
		return;
	}
	if (display === Display.CAM) {
		display = lastDisplay;
		displaySelector.value = lastDisplay;
	}
	const x = Math.round(event.offsetX);
	const y = Math.round(event.offsetY);
	const minX = Math.max(x - sampleSize, 0);
	const minY = Math.max(y - sampleSize, 0);
	const maxX = Math.min(x + sampleSize, width - 1);
	const maxY = Math.min(y + sampleSize, height - 1);
	const sampleWidth = maxX- minX;
	const sampleHeight = maxY - minY;
	const numPixels = sampleWidth * sampleHeight;
	const numSampleBytes = numPixels * 4;
	let red = 0, green = 0, blue = 0;
	context.drawImage(video, 0, 0);
	const pixels = context.getImageData(minX, minY, sampleWidth, sampleHeight).data;
	for (let i = 0; i < numSampleBytes; i += 4) {
		red += pixels[i];
		green += pixels[i + 1];
		blue += pixels[i + 2];
	}
	red = red / numPixels;
	green = green / numPixels;
	blue = blue / numPixels;
	targetColor = rgbToHCL(red, green, blue);
});

function rgbToHCL(red, green, blue) {
	red /= 255;
	green /= 255;
	blue /= 255;
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const delta = max - min;
	let hue;
	if (delta === 0) {
		hue = 0;
	} else if (max === red) {
		hue = ((green - blue) / delta) % 6;
	} else if (max === green) {
		hue = (blue - red) / delta + 2;
	} else {
		hue = (red - green) / delta + 4;
	}
	if (hue < 0) {
		hue += 6;
	}
	hue /= 6;
	const lightness = (red + green + blue) / 3;
	return [hue, delta, lightness];
}

function colorDifference(color1, color2) {
	let hueDiff;
	if (color1[1] === 0 || color2[1] === 0) {
		hueDiff = 0;
	} else {
		hueDiff = Math.abs(color1[0] - color2[0]);
		if (hueDiff > 0.5) {
			hueDiff = 1 - hueDiff;
		}
	}
	const chromaDiff = Math.abs(color1[1] - color2[1]);
	const lightnessDiff = Math.abs(color1[2] - color2[2]);
	return [hueDiff, chromaDiff, lightnessDiff];
}

canvas.addEventListener('contextmenu', function (event) {
	event.preventDefault();
});

document.getElementById('hue-threshold').addEventListener('input', function (event) {
	hueThreshold = parseFloat(this.value) / 1530;
});

document.getElementById('chroma-threshold').addEventListener('input', function (event) {
	chromaThreshold = parseFloat(this.value) / 255;
});

document.getElementById('lightness-threshold').addEventListener('input', function (event) {
	lightnessThreshold = parseFloat(this.value) / 765;
});

displaySelector.addEventListener('input', function (event) {
	display = parseInt(this.value);
	if (display === Display.COLOR_KEY || display === Display.BLOBS) {
		lastDisplay = display;
	}
});

document.getElementById('camera-activation').addEventListener('click', async function (event) {
	if (display === Display.STOPPED) {
		await startCam();
	} else {
		stopCam();
	}
});

document.getElementById('color-keying').addEventListener('input', function (event) {
	const value = this.value;
	keyColor[0] = parseInt(value.substr(1, 2), 16);
	keyColor[1] = parseInt(value.substr(3, 2), 16);
	keyColor[2] = parseInt(value.substr(5, 2), 16);
});
