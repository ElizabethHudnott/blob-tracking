'use strict';

const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
let targetColor = [0, 0, 0];
let sampleSize = 2;
let lastUpdate = 0;
let hueThreshold = parseFloat(document.getElementById('hue-threshold').value) / 1530;
let chromaThreshold = parseFloat(document.getElementById('chroma-threshold').value) / 255;
let lightnessThreshold = parseFloat(document.getElementById('lightness-threshold').value) / 2550;
let width, height, numBytes, updatePeriod;
let trackBlobs = false;

function showWebcam(time) {
	requestAnimationFrame(showWebcam);
	if (time - lastUpdate < updatePeriod) {
		return;
	}
	context.drawImage(video, 0, 0);
	if (!trackBlobs) {
		return;
	}
	const imageData = context.getImageData(0, 0, width, height);
	const pixels = imageData.data;
	for (let i = 0; i < numBytes; i += 4) {
		const red = pixels[i];
		const green = pixels[i + 1];
		const blue = pixels[i + 2];
		const hcl = rgbToHCL(red, green, blue);
		let hueDiff;
		if (hcl[1] === 0 || targetColor[1] === 0) {
			hueDiff = 0;
		} else {
			hueDiff = Math.abs(hcl[0] - targetColor[0]);
			if (hueDiff > 0.5) {
				hueDiff = 1 - hueDiff;
			}
		}
		const chromaDiff = Math.abs(hcl[1] - targetColor[1]);
		const lightnessDiff = Math.abs(hcl[2] - targetColor[2]);
		if (
			hueDiff <= hueThreshold && chromaDiff <= chromaThreshold &&
			lightnessDiff <= lightnessThreshold
		) {
			pixels[i] = 0;
			pixels[i + 1] = 0;
			pixels[i + 2] = 0;
		}
	}
	context.putImageData(imageData, 0, 0);
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
	canvas.width = width;
	canvas.height = height;
	requestAnimationFrame(showWebcam);
})
.catch(function (error) {
	console.error(error);
});

canvas.addEventListener('pointerdown', function (event) {
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
	const lightness = 0.212 * red + 0.701 * green + 0.087 * blue;
	return [hue, delta, lightness];
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
	lightnessThreshold = parseFloat(this.value) / 2550;
});
