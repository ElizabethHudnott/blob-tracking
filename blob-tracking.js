'use strict';

const TWO_PI = 2 * Math.PI;

function compareNumbers(a, b) {
	return a - b;
}

class BlobShape {
	constructor(x, y) {
		this.left = x;
		this.right = x;
		this.top = y;
		this.bottom = y;
		this.xCoords = [x];
		this.yCoords = [y];
	}

	test(x, y) {
		const inside =
			y <= this.bottom + blobDistance &&
			x >= this.left - blobDistance &&
			x <= this.right + blobDistance
		return inside;
	}

	add(x, y) {
		if (x < this.left) {
			this.left = x;
		} else if (x > this.right) {
			this.right = x;
		}
		if (y > this.bottom) {
			this.bottom = y;
		}
		this.xCoords.push(x);
		this.yCoords.push(y);
	}

	get numPoints() {
		return this.xCoords.length;
	}

	get centre() {
		this.xCoords.sort(compareNumbers);
		this.yCoords.sort(compareNumbers);
		const index = Math.trunc((this.xCoords.length - 1) / 2);
		return [this.xCoords[index], this.yCoords[index]];
	}

	get width() {
		return this.right - this.left + 1;
	}

	get height() {
		return this.bottom - this.top + 1;
	}

}

const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
const offscreenCanvas = document.createElement('CANVAS');
const offscreenContext = offscreenCanvas.getContext('2d');
const filter = 'blur(1)';
context.filter = filter;
offscreenContext.filter = filter;
context.lineWidth = 4;
const displaySelector = document.getElementById('camera-display');
let targetColor = [0, 0, 0];
let sampleSize = 1;
let lastUpdate = 0;
let subtractBackground = document.getElementById('subtract-background').checked;
let fgHueThreshold = parseFloat(document.getElementById('hue-threshold').value) / 1530;
let fgChromaThreshold = parseFloat(document.getElementById('chroma-threshold').value) / 255;
let fgIntensityThreshold = parseFloat(document.getElementById('intensity-threshold').value) / 765;
let bgHueThreshold = 0.5, bgChromaThreshold = 1, bgIntensityThreshold = 1;
let blobDistance = 30;
let minPointsInBlob = 800;
let pointSize = 8;
let motionThreshold = parseFloat(document.getElementById('motion-threshold').value);
let hueMotionWeight = parseFloat(document.getElementById('motion-hue-weight').value);
motionThreshold *= motionThreshold;
let videoTrack, width, height, bytesPerRow, numBytes, updatePeriod, animID;
let displayData, previousPixels, backgroundPixels;
let keyColor = [0, 0, 0];

const Display = Object.freeze({
	OFF: 0,
	CAM: 1,
	BACKGROUND_SUBTRACTION: 2,
	COLOR_KEY: 3,
	BLOBS: 4,
	MOTION_TRACKER: 5,
});

let display = Display.STOPPED;
let lastDisplay = Display.COLOR_KEY;

function showWebcam(time) {
	animID = requestAnimationFrame(showWebcam);
	if (time - lastUpdate < updatePeriod) {
		return;
	}
	if (display !== Display.MOTION_TRACKER) {
		context.drawImage(video, 0, 0);
		displayData = context.getImageData(0, 0, width, height);
	}
	offscreenContext.drawImage(video, 0, 0);

	const imageData = offscreenContext.getImageData(0, 0, width, height);
	const pixels = imageData.data;
	const displayPixels = displayData.data;
	const blobs = [];

	for (let i = 0; i < numBytes; i += 4) {
		let red = pixels[i];
		let green = pixels[i + 1];
		let blue = pixels[i + 2];
		let hci = rgbToHCI(red, green, blue);
		let colorVector = colorDifference(hci, targetColor);
		const colorMatch = colorVector[0] <= fgHueThreshold && colorVector[1] <= fgChromaThreshold && colorVector[2] <= fgIntensityThreshold;

		let backgroundMatch = false;
		if (subtractBackground) {
			const backgroundColor = [backgroundPixels[i] / 255, backgroundPixels[i + 1] / 255, backgroundPixels[i + 2] / 255];
			colorVector = colorDifference(hci, backgroundColor);
			backgroundMatch = colorVector[0] <= bgHueThreshold && colorVector[1] <= bgChromaThreshold && colorVector[2] <= bgIntensityThreshold;;
		}

		const previousColor = [previousPixels[i] / 255, previousPixels[i + 1] / 255, previousPixels[i + 2] / 255];
		colorVector = colorDifference(hci, previousColor);
		const motionMatch = hueMotionWeight * colorVector[0] * colorVector[0] + colorVector[1] * colorVector[1] + colorVector[2] * colorVector[2] >= motionThreshold;

		if (backgroundMatch) {
			if (display === Display.BACKGROUND_SUBTRACTION) {
				displayPixels[i] = keyColor[0];
				displayPixels[i + 1] = keyColor[1];
				displayPixels[i + 2] = keyColor[2];
			}
		} else if (colorMatch) {
			const y = Math.trunc(i / bytesPerRow);
			const x = (i % bytesPerRow) / 4;
			let found = false;
			for (let j = blobs.length - 1; j >= 0; j--) {
				const blob = blobs[j];
				if (blob.test(x, y)) {
					blob.add(x, y);
					found = true;
					break;
				}
			}
			if (!found) {
				blobs.push(new BlobShape(x, y));
			}
			if (display === Display.COLOR_KEY) {
				displayPixels[i] = keyColor[0];
				displayPixels[i + 1] = keyColor[1];
				displayPixels[i + 2] = keyColor[2];
			}
		}

		if (display === Display.MOTION_TRACKER) {
			displayPixels[i + 3] = motionMatch ? 0 : 255;	// Set alpha
		}

		previousPixels[i] = hci[0] * 255;
		previousPixels[i + 1] = hci[1] * 255;
		previousPixels[i + 2] = hci[2] * 255;
	}
	if (display === Display.BLOBS) {
		context.beginPath();
		for (let blob of blobs) {
			if (blob.numPoints >= minPointsInBlob) {
				context.strokeRect(blob.left, blob.top, blob.width, blob.height);
				const [x, y] = blob.centre;
				context.moveTo(x, y);
				context.arc(x, y, pointSize, 0, TWO_PI);
			}
		}
		context.fill();
	} else {
		context.putImageData(displayData, 0, 0);
	}
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
		bytesPerRow = width * 4;
		numBytes = bytesPerRow * height;
		updatePeriod = 1000 / info.frameRate;
		canvas.width = width;
		canvas.height = height;
		offscreenCanvas.width = width;
		offscreenCanvas.height = height;
		previousPixels = new Uint8ClampedArray(numBytes);
		if (backgroundPixels === undefined || backgroundPixels.length !== numBytes) {
			backgroundPixels = new Uint8ClampedArray(numBytes);
		}
		animID = requestAnimationFrame(showWebcam);
		display = parseInt(displaySelector.value);
		button.innerHTML = 'Stop';
		setKeyColor(document.getElementById('color-keying').value);
	}  catch(error) {
		console.error(error);
	} finally {
		button.disabled = false;
	}
}

startCam();

function stopCam() {
	cancelAnimationFrame(animID);
	context.clearRect(0, 0, width, height);
	videoTrack.stop();
	video.srcObject = null;
	display = Display.STOPPED;
	document.getElementById('camera-activation').innerHTML = 'Start';
}

function captureBackground() {
	backgroundPixels = previousPixels.slice();
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
	targetColor = rgbToHCI(red, green, blue);
});

function rgbToHCI(red, green, blue) {
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
	const value = parseFloat(this.value) / 1530;
	if (display === Display.BACKGROUND_SUBTRACTION) {
		bgHueThreshold = value;
	} else {
		fgHueThreshold = value;
	}
});

document.getElementById('chroma-threshold').addEventListener('input', function (event) {
	const value = parseFloat(this.value) / 255;
	if (display === Display.BACKGROUND_SUBTRACTION) {
		bgChromaThreshold = value;
	} else {
		fgChromaThreshold = value;
	}
});

document.getElementById('intensity-threshold').addEventListener('input', function (event) {
	const value = parseFloat(this.value) / 765;
	if (display === Display.BACKGROUND_SUBTRACTION) {
		bgIntensityThreshold = value;
	} else {
		fgIntensityThreshold = value;
	}
});

document.getElementById('motion-threshold').addEventListener('input', function (event) {
	let value = parseFloat(this.value);
	if (value > 0) {
		motionThreshold = value * value;
	}
});

document.getElementById('motion-hue-weight').addEventListener('input', function (event) {
	const value = parseFloat(this.value);
	if (value >= 0) {
		hueMotionWeight = value;
	}
});

displaySelector.addEventListener('input', function (event) {
	display = parseInt(this.value);
	switch (display) {
	case Display.COLOR_KEY:
	case Display.BLOBS:
		lastDisplay = display;
		break;
	case Display.MOTION_TRACKER:
		displayData.data.fill(0);
		break;
	}

	const bgSubtractEnable = document.getElementById('subtract-background');
	if (display === Display.BACKGROUND_SUBTRACTION) {
		document.getElementById('hue-threshold').value = bgHueThreshold * 1530;
		document.getElementById('chroma-threshold').value = bgChromaThreshold * 255;
		document.getElementById('intensity-threshold').value = bgIntensityThreshold * 765;
		bgSubtractEnable.disabled = true;
		subtractBackground = true;
	} else {
		document.getElementById('hue-threshold').value = fgHueThreshold * 1530;
		document.getElementById('chroma-threshold').value = fgChromaThreshold * 255;
		document.getElementById('intensity-threshold').value = fgIntensityThreshold * 765;
		bgSubtractEnable.disabled = false;
		subtractBackground = bgSubtractEnable.checked;
	}
});

document.getElementById('camera-activation').addEventListener('click', async function (event) {
	if (display === Display.STOPPED) {
		await startCam();
	} else {
		stopCam();
	}
});

function setKeyColor(hexColor) {
	keyColor[0] = parseInt(hexColor.substr(1, 2), 16);
	keyColor[1] = parseInt(hexColor.substr(3, 2), 16);
	keyColor[2] = parseInt(hexColor.substr(5, 2), 16);
	context.strokeStyle = hexColor;
	context.fillStyle = hexColor;
}

document.getElementById('color-keying').addEventListener('input', function (event) {
	setKeyColor(this.value);
});

document.getElementById('subtract-background').addEventListener('input', function (event) {
	subtractBackground = this.checked;
});

window.addEventListener('blur', stopCam);

document.body.addEventListener('keydown', function (event) {
	if (event.key === ' ') {
		captureBackground();
	}
})
