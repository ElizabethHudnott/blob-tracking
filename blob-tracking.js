'use strict';

const video = document.getElementById('webcam');
const camCanvas = document.getElementById('cam-canvas');
const motionCanvas = document.getElementById('motion-canvas');
const camContext = camCanvas.getContext('2d');
const motionContext = motionCanvas.getContext('2d');
let targetColor = [0, 0, 0];
let sampleSize = 2;
let lastUpdate = 0;
let hueThreshold = parseFloat(document.getElementById('hue-threshold').value) / 1530;
let chromaThreshold = parseFloat(document.getElementById('chroma-threshold').value) / 255;
let lightnessThreshold = parseFloat(document.getElementById('lightness-threshold').value) / 2550;
let motionThreshold = 0.01;
let width, height, numBytes, updatePeriod, previousPixels;
let trackBlobs = false;
let showColorOverlay = true;

function showWebcam(time) {
	requestAnimationFrame(showWebcam);
	if (time - lastUpdate < updatePeriod) {
		return;
	}
	camContext.drawImage(video, 0, 0);
	if (!trackBlobs) {
		return;
	}
	const imageData = camContext.getImageData(0, 0, width, height);
	const pixels = imageData.data;
	const currentPixels = showColorOverlay ? pixels.slice() : pixels;
	const motionData = motionContext.createImageData(width, height);
	const motionPixels = motionData.data;
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
		const motionMatch = colorVector[0] * colorVector[0] + colorVector[1] * colorVector[1] + colorVector[2] * colorVector[2] >= motionThreshold;

		if (colorMatch) {
			if (showColorOverlay) {
				pixels[i] = 0;
				pixels[i + 1] = 0;
				pixels[i + 2] = 0;
			}
		}
		motionPixels[i + 3] = motionMatch ? 0 : 255;	// Set alpha
	}
	if (showColorOverlay) {
		camContext.putImageData(imageData, 0, 0);
	}
	motionContext.putImageData(motionData, 0, 0);
	previousPixels = currentPixels;
	lastUpdate = time;
}

navigator.mediaDevices.getUserMedia({
	video: { facingMode: 'user' }
})
.then(function (stream) {
	video.srcObject = stream;
	const info = stream.getVideoTracks()[0].getSettings();
	width = info.width;
	height = info.height;
	numBytes = width * height * 4;
	updatePeriod = 1000 / info.frameRate;
	camCanvas.width = width;
	camCanvas.height = height;
	motionCanvas.width = width;
	motionCanvas.height = height;
	previousPixels = new Uint8ClampedArray(numBytes);
	requestAnimationFrame(showWebcam);
})
.catch(function (error) {
	console.error(error);
});

camCanvas.addEventListener('pointerdown', function (event) {
	if (event.button === 2) {
		trackBlobs = false;
		return;
	}
	trackBlobs = true;
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
	camContext.drawImage(video, 0, 0);
	const pixels = camContext.getImageData(minX, minY, sampleWidth, sampleHeight).data;
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
	const lightness = 0.212 * red + 0.701 * green + 0.087 * blue;
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

camCanvas.addEventListener('contextmenu', function (event) {
	event.preventDefault();
});

document.getElementById('hue-threshold').addEventListener('input', function (event) {
	hueThreshold = parseFloat(this.value) / 1530;
});

document.getElementById('chroma-threshold').addEventListener('input', function (event) {
	chromaThreshold = parseFloat(this.value) / 255;
});

document.getElementById('lightness-threshold').addEventListener('input', function (event) {
	lightnessThreshold = parseFloat(this.value) / 2550;
});
