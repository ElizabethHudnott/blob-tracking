'use strict';

const TWO_PI = 2 * Math.PI;
const POINT_SIZE = 7;

function compareNumbers(a, b) {
	return a - b;
}

class Point {
	constructor(x, y) {
		this.x = x;
		this.y = y;
	}
}

class BlobShape {
	constructor(x, y) {
		this.left = x;
		this.right = x;
		this.top = y;
		this.bottom = y;
		this.xCoordsOnRow = [x];
		this.leftBoundary = [];
		this.rightBoundary = [];
		this.hull = undefined;
		this.numPoints = 0;
	}

	distanceX(x) {
		let distance = 0;
		if (x < this.left) {
			distance = this.left - x;
		} else if (x > this.right) {
			distance = x - this.right;
		}
		return distance;
	}

	distanceY(y) {
		return y - this.bottom;
	}

	add(x, y) {
		if (y === this.top) {
			this.right = x;
		} else if (y > this.bottom) {
			this.finalizeRow();
			this.left = x;
			this.bottom = y;
		}
		this.xCoordsOnRow.push(x);
	}

	finalizeRow() {
		const coordsOnRow = this.xCoordsOnRow;
		const numCoords = coordsOnRow.length;
		this.numPoints += numCoords;
		const lb = Math.trunc((numCoords - 1) * (1 - boundaryFraction));
		const ub = Math.trunc((numCoords - 1) * boundaryFraction);
		this.leftBoundary.push(coordsOnRow[lb]);
		this.rightBoundary.push(coordsOnRow[ub]);
		this.right = coordsOnRow[numCoords - 1];
		this.xCoordsOnRow = [];
	}

	findComplexHull() {
		const leftBoundary = this.leftBoundary;
		const rightBoundary = this.rightBoundary;
		const numRows = leftBoundary.length;
		const points = [];
		for (let i = 0; i < numRows; i++) {
			const y = this.top + i;
			points.push(new Point(width - leftBoundary[i], y));
			points.push(new Point(width - rightBoundary[i], y));
		}
		this.hull = convexhull.makeHullPresorted(points);
	}

	merge(blob2) {
		let canMerge = false;
		let j = blob2.top - this.top;
		let j2 = 0;
		const leftPoints = this.leftBoundary;
		const rightPoints = this.rightBoundary;
		const leftPoints2 = blob2.leftBoundary;
		const rightPoints2 = blob2.rightBoundary;
		let newLeft, newRight;
		if (j >= 0) {
			// blob2 is lower than this blob
			newLeft = leftPoints.slice(0, j);
			newRight = rightPoints.slice(0, j);
		} else {
			// This blob is lower than blob2
			j2 = -j;
			j = 0;
			newLeft = leftPoints2.slice(0, j2);
			newRight = rightPoints2.slice(0, j2);
		}
		const numRows = leftPoints.length;
		const numRows2 = leftPoints2.length;
		do {
			const left = leftPoints[j];
			const left2 = leftPoints2[j2];
			const minLeft = Math.min(left, left2);
			const right = rightPoints[j];
			const right2 = rightPoints2[j2];
			const maxRight = Math.max(right, right2);
			if (
				(right >= left2 && left <= right2) ||
				(right2 >= left && left2 <= right)
			) {
				canMerge = true;
			}
			newLeft.push(minLeft);
			newRight.push(maxRight);
			j++;
			j2++;
		} while (j < numRows && j2 <numRows2);
		if (canMerge) {
			newLeft.push(...leftPoints.slice(j));
			newRight.push(...rightPoints.slice(j));
			newLeft.push(...leftPoints2.slice(j2));
			newRight.push(...rightPoints2.slice(j2));
			this.top = Math.min(this.top, blob2.top);
			this.leftBoundary = newLeft;
			this.rightBoundary = newRight;
			return true;
		}
		return false;
	}

	tracePath(context) {
		const points = this.hull;
		const numPoints = points.length;
		let point = points[0];
		context.moveTo(point.x, point.y);
		for (let i = 1; i < numPoints; i++) {
			point = points[i];
			context.lineTo(point.x, point.y);
		}
		context.closePath();
	}

	centre() {
		const leftBoundary = this.leftBoundary;
		const rightBoundary = this.rightBoundary;
		const numRows = leftBoundary.length;
		let totalX = 0;
		let totalY = 0;
		let area = 0;
		for (let i = 0; i < numRows; i++) {
			const left = leftBoundary[i];
			const right = rightBoundary[i];
			totalX += (left + right) / 2;
			const pointsOnRow = (right - left + 1);
			totalY += (i + 1) * pointsOnRow;
			area += pointsOnRow;
		}
		const totalXMoment = totalX / numRows;
		const totalYMoment = this.top + totalY / area - 1;
		return [width - totalXMoment, totalYMoment];
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
let blobDistanceX = parseInt(document.getElementById('blob-distance').value);
let minBlobPoints = parseInt(document.getElementById('min-blob-points').value);
let boundaryFraction = parseFloat(document.getElementById('blob-boundary-percentile').value) / 100;
let motionThreshold = parseFloat(document.getElementById('motion-threshold').value);
let hueMotionWeight = parseFloat(document.getElementById('motion-hue-weight').value);
motionThreshold *= motionThreshold;
let videoTrack, width, height, bytesPerRow, numBytes, updatePeriod, animID;
let displayData, previousPixels, backgroundPixels;
let keyColor = [0, 0, 0];

const Display = Object.freeze({
	OFF: 0,
	CAMERA: 1,
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
		if (display === Display.CAMERA) {
			return;
		}
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
			let matched = false;
			for (let j = 0; j < blobs.length; j++) {
				const blob = blobs[j];
				const dx = blob.distanceX(x);
				const dy = blob.distanceY(y);
				if (dx <= blobDistanceX && dy <= 1) {
					blobs[j].add(x, y);
					matched = true;
				}
			}
			if (!matched) {
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
		for (let blob of blobs) {
			blob.finalizeRow();
		}
		let found;
		do {
			let i = 0;
			found = false;
			while (i < blobs.length) {
				const blob = blobs[i];
				let j = i + 1;
				while (j < blobs.length) {
					const blob2 = blobs[j];
					const merged = blob.merge(blob2);
					if (merged) {
						blobs.splice(j, 1);
						found = true;
					} else {
						j++;
					}
				}
				i++;
			}
		} while (found);

		for (let blob of blobs) {
			if (blob.numPoints >= minBlobPoints) {
				blob.findComplexHull();
				context.beginPath();
				blob.tracePath(context);
				context.stroke();
				const [x, y] = blob.centre();
				context.beginPath();
				context.moveTo(x, y);
				context.arc(x, y, POINT_SIZE, 0, TWO_PI);
				context.fill();
			}
		}
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
		context.setTransform(1, 0, 0, 1, width / 2, 0);
		context.scale(-1, 1);
		context.translate(-width / 2, 0);
		offscreenCanvas.width = width;
		offscreenCanvas.height = height;
		offscreenContext.setTransform(1, 0, 0, 1, width / 2, 0);
		offscreenContext.scale(-1, 1);
		offscreenContext.translate(-width / 2, 0);
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
		display = Display.CAMERA;
		displaySelector.value = Display.CAMERA;
		return;
	}
	if (display === Display.CAMERA) {
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

document.getElementById('blob-distance').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (value > 0) {
		blobDistanceX = value;
	}
});

document.getElementById('min-blob-points').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (value > 0) {
		minBlobPoints = value;
	}
});

document.getElementById('blob-boundary-percentile').addEventListener('input', function (event) {
	const value = parseFloat(this.value);
	if (value >= 50 && value <= 100) {
		boundaryFraction = value / 100;
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
