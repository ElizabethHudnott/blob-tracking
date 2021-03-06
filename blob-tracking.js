'use strict';

const TWO_PI = 2 * Math.PI;

const video = document.getElementById('webcam');
const canvas = document.getElementById('camera-canvas');
const context = canvas.getContext('2d');
const offscreenCanvas = document.createElement('CANVAS');
const offscreenContext = offscreenCanvas.getContext('2d');
const filter = 'blur(1)';
const bell = document.getElementById('bell');
const displaySelector = document.getElementById('camera-display');
let targetColor = [0, 0, 0];
let sampleSize = 1;
let lastUpdate = 0;
let numBackgroundFrames = 51;
let subtractBackground = document.getElementById('subtract-background').checked;
let fgHueThreshold = parseInt(document.getElementById('hue-threshold').value);
let fgSaturationThreshold = parseInt(document.getElementById('saturation-threshold').value);
let fgIntensityThreshold = parseInt(document.getElementById('intensity-threshold').value);
let bgHueThreshold = 65535, bgSaturationThreshold = 65535, bgIntensityThreshold = 765;
let blobDistanceX = parseInt(document.getElementById('blob-distance-x').value);
let blobDistanceY = parseInt(document.getElementById('blob-distance-y').value);
let boundaryFraction = parseFloat(document.getElementById('blob-boundary-percent').value) / 100;
let minBlobPoints = parseInt(document.getElementById('min-blob-points').value);
let maxTTL = parseInt(document.getElementById('blob-max-ttl').value);
let motionThreshold = parseFloat(document.getElementById('motion-threshold').value);
let videoTrack, width, height, bytesPerRow, numBytes, updatePeriod, animID;
let displayData, motionDataSwap, hsiaPixels, previousPixels, backgroundPixels, backgroundFrames = [], keyColor;
let capturingBackground = false;
let keyColorComponents = [0, 0, 0];
let previousBlobs = [];

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
	static activeIDs = new Set();
	static tryNextID = 1;

	constructor(x, y) {
		this.minLeft = undefined;
		this.maxRight = undefined;
		this.left = x;
		this.right = x;
		this.top = y;
		this.bottom = y;
		this.xCoordsOnRow = [x];
		this.leftBoundary = [];
		this.rightBoundary = [];
		this.numPoints = 0;
		this.hasMerged = false;
		this.hull = undefined;
		this.centreX = 0;
		this.centreY = 0;
		this.id = undefined;
		this.taken = false;
		this.ttl = maxTTL;
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
			const lastRowNum = this.leftBoundary.length - 1;
			const prevLeft = this.leftBoundary[lastRowNum];
			const prevRight = this.rightBoundary[lastRowNum]
			const gradient = (x - prevLeft) / (y - this.bottom);
			this.bottom++;
			let intermediateX = prevLeft;
			while (y !== this.bottom) {
				intermediateX += gradient;
				this.leftBoundary.push(intermediateX);
				this.rightBoundary.push(prevRight);
				this.bottom++;
			}
			this.left = x;

		} else if (x >= this.right) {
			this.right++;
		}

		this.xCoordsOnRow.push(x);
	}

	finalizeRow() {
		const coordsOnRow = this.xCoordsOnRow;
		const numCoords = coordsOnRow.length;
		const lb = Math.round((numCoords - 1) * (1 - boundaryFraction));
		const ub = Math.round((numCoords - 1) * boundaryFraction);
		this.numPoints += ub - lb + 1;
		const left = coordsOnRow[lb];
		const right = coordsOnRow[ub];
		if (this.leftBoundary.length === 0) {
			this.minLeft = left;
			this.maxRight = right;
		} else {
			this.minLeft = Math.min(left, this.minLeft);
			this.maxRight = Math.max(right, this.maxRight);
		}
		this.leftBoundary.push(left);
		this.rightBoundary.push(right);
		this.right = coordsOnRow[numCoords - 1];
		this.xCoordsOnRow = [];
	}

	get width() {
		return this.maxRight - this.minLeft;
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
		const leftPoints = this.leftBoundary;
		const rightPoints = this.rightBoundary;
		const leftPoints2 = blob2.leftBoundary;
		const rightPoints2 = blob2.rightBoundary;
		const numRows = leftPoints.length;
		const numRows2 = leftPoints2.length;

		let canMerge = false;
		if (this.bottom === blob2.top - 1) {
			const left = this.leftBoundary[numRows - 1];
			const right = this.rightBoundary[numRows - 1];
			const left2 = blob2.leftBoundary[0];
			const right2 = blob2.rightBoundary[0];
			canMerge = right >= left2 && right2 >= left;
		} else if (blob2.bottom === this.top - 1) {
			const left = blob2.leftBoundary[numRows2 - 1];
			const right = blob2.rightBoundary[numRows2 - 1];
			const left2 = this.leftBoundary[0];
			const right2 = this.rightBoundary[0];
			canMerge = right >= left2 && right2 >= left;
		}

		let j = blob2.top - this.top;
		let j2 = 0;
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
		let intersectingPoints = 0;
		do {
			const left = leftPoints[j];
			const left2 = leftPoints2[j2];
			const right = rightPoints[j];
			const right2 = rightPoints2[j2];
			if (right >= left2 && left <= left2) {
				// Blob 1 to the left of Blob 2
				canMerge = true;
				newLeft.push(left);
				newRight.push(right2);
				intersectingPoints += right - left2;
			} else if (right2 >= left && left2 <= left) {
				// Blob 2 to the left of Blob 1
				canMerge = true;
				newLeft.push(left2);
				newRight.push(right);
				intersectingPoints += right2 - left;
			} else if (left <= left2 && right >= right2) {
				// Blob 1 contains Blob 2
				canMerge = true;
				newLeft.push(left);
				newRight.push(right);
				intersectingPoints += right2 - left2;
			} else if (left2 <= left && right2 >= right) {
				// Blob 2 contains Blob 1
				canMerge = true;
				newLeft.push(left2);
				newRight.push(right2);
				intersectingPoints += right - left;
			}
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
			this.numPoints += blob2.numPoints - intersectingPoints;
			this.hasMerged = true;
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

	computeCentre() {
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
		const totalYMoment = this.top + totalY / area;
		this.centreX = width - totalXMoment
		this.centreY = totalYMoment;
	}

	generateID() {
		let id = BlobShape.tryNextID;
		while (BlobShape.activeIDs.has(id)) {
			id++;
		}
		if (id < 2 && this.maxRight >= width * 0.66) {
			// Reserve ID 1 for the left hand.
			while (id < 2 || BlobShape.activeIDs.has(id)) {
				id++;
			}
		} else {
			BlobShape.tryNextID = id + 1;
		}
		this.id = id;
		BlobShape.activeIDs.add(id);
	}

	isOffscreen() {
		if (this.taken) {
			return false;
		}
		this.ttl--;
		if (this.ttl > 0) {
			return true;
		}

		const id = this.id;
		BlobShape.activeIDs.delete(id);
		if (BlobShape.tryNextID > id) {
			BlobShape.tryNextID = id;
		}
		return false;
	}

}

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

	offscreenContext.drawImage(video, 0, 0);
	const imageData = offscreenContext.getImageData(0, 0, width, height);
	const pixels = imageData.data;

	for (let i = 0; i < numBytes; i += 4) {
		const red = pixels[i];
		const green = pixels[i + 1];
		const blue = pixels[i + 2];
		const hsi = rgbToHSI(red, green, blue);
		hsiaPixels[i] = hsi[0];
		hsiaPixels[i + 1] = hsi[1];
		hsiaPixels[i + 2] = hsi[2];
	}

	if (capturingBackground) {
		backgroundFrames.push(hsiaPixels.slice());

		if (backgroundFrames.length < numBackgroundFrames) {
			return;
		}

		bell.play();
		const midIndex = Math.trunc((numBackgroundFrames - 1) * 0.5);
		const circleFraction = Math.PI / 32768;
		const saturationValues = new Uint16Array(numBackgroundFrames);
		const intensityValues = new Uint16Array(numBackgroundFrames);
		let totalHueX = 0, totalHueY = 0;

		for (let i = 0; i < numBytes; i += 4) {
			for (let j = 0; j < numBackgroundFrames; j++) {
				saturationValues[j] = backgroundFrames[j][i + 1];
				intensityValues[j] = backgroundFrames[j][i + 2];
				const hue = backgroundFrames[j][i];
				totalHueX += Math.cos(circleFraction * hue);
				totalHueY += Math.sin(circleFraction * hue);
			}
			saturationValues.sort();
			backgroundPixels[i + 1] = saturationValues[midIndex];
			intensityValues.sort();
			backgroundPixels[i + 2] = intensityValues[midIndex];
			let hue;
			if (totalHueX === 0 && totalHueY === 0) {
				hue = hsiaPixels[i];
			} else {
				let angle = Math.atan2(totalHueY, totalHueX);
				if (angle < 0) {
					angle += TWO_PI;
				}
				hue = angle / circleFraction;
			}
			backgroundPixels[i] = hue;
		}

		capturingBackground = false;
		backgroundFrames = [];
	}

	context.setTransform(-1, 0, 0, 1, width, 0);
	if (display !== Display.MOTION_TRACKER) {
		context.drawImage(video, 0, 0);
		if (display === Display.CAMERA) {
			return;
		}
		displayData = context.getImageData(0, 0, width, height);
	}

	const displayPixels = displayData.data;
	const blobs = [];

	for (let i = 0; i < numBytes; i += 4) {
		const hue = hsiaPixels[i];
		const saturation = hsiaPixels[i + 1];
		const intensity = hsiaPixels[i + 2];
		let colorVector = colorDifference(hue, saturation, intensity, targetColor);
		const colorMatch = colorVector[0] <= fgHueThreshold && colorVector[1] <= fgSaturationThreshold && colorVector[2] <= fgIntensityThreshold;

		let backgroundMatch = false;
		if (subtractBackground) {
			const backgroundColor = [ backgroundPixels[i], backgroundPixels[i + 1], backgroundPixels[i + 2] ];
			colorVector = colorDifference(hue, saturation, intensity, backgroundColor);
			backgroundMatch = colorVector[0] <= bgHueThreshold && colorVector[1] <= bgSaturationThreshold && colorVector[2] <= bgIntensityThreshold;;
		}

		const previousIntensity = previousPixels[i / 4];
		const motionMatch = Math.abs(intensity - previousIntensity) >= motionThreshold;

		if (display === Display.MOTION_TRACKER) {

			displayPixels[i + 3] = motionMatch ? 0 : 255;	// Set alpha

		} else if (backgroundMatch) {

			if (display === Display.BACKGROUND_SUBTRACTION) {
				displayPixels[i] = keyColorComponents[0];
				displayPixels[i + 1] = keyColorComponents[1];
				displayPixels[i + 2] = keyColorComponents[2];
			}

		} else if (display === Display.COLOR_KEY) {

				if (colorMatch) {
					displayPixels[i] = keyColorComponents[0];
					displayPixels[i + 1] = keyColorComponents[1];
					displayPixels[i + 2] = keyColorComponents[2];
				}

		} else if (display === Display.BLOBS) {

			if (colorMatch) {
				const y = Math.trunc(i / bytesPerRow);
				const x = (i % bytesPerRow) / 4;
				let matched = false;
				for (let j = 0; j < blobs.length; j++) {
					const blob = blobs[j];
					const dx = blob.distanceX(x);
					const dy = blob.distanceY(y);
					if (dx <= blobDistanceX && (
						dy <= 1 ||
						(dy <= blobDistanceY && dx <= y - blob.bottom)
					)) {
						blobs[j].add(x, y);
						matched = true;
					}
				}
				if (!matched) {
					blobs.push(new BlobShape(x, y));
				}
			}

		}

		previousPixels[i / 4] = intensity;
	}

	if (display === Display.MOTION_TRACKER) {
		dilate();
	}

	context.putImageData(displayData, 0, 0);

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
			i = 0;
			while (i < blobs.length) {
				const blob = blobs[i];
				if (blob.hasMerged || blob.numPoints >= minBlobPoints) {
					i++;
					blob.hasMerged = false;
				} else {
					blobs.splice(i, 1);
				}
			}
		} while (found);

		context.beginPath();
		for (let blob of blobs) {
			blob.computeCentre();
			blob.findComplexHull();
			blob.tracePath(context);
		}
		context.stroke();

		const numBlobs = blobs.length;
		const numPrevious = previousBlobs.length;
		if (numPrevious === 0) {
			for (let blob of blobs) {
				blob.generateID();
			}
		} else if (numBlobs >= numPrevious) {
			// More current blobs than previous blobs
			for (let previousBlob of previousBlobs) {
				let closestDistanceSq = Infinity;
				let closestIndex = 0;
				const prevX = previousBlob.centreX;
				const prevY = previousBlob.centreY;
				for (let i = 0; i < numBlobs; i++) {
					const blob = blobs[i];
					if (!blob.taken) {
						const x = blob.centreX;
						const y = blob.centreY;
						const dx = x - prevX;
						const dy = y - prevY;
						const distanceSq = dx * dx + dy * dy;
						if (distanceSq < closestDistanceSq) {
							closestIndex = i;
							closestDistanceSq = distanceSq;
						}
					}
				}
				const closestBlob = blobs[closestIndex];
				closestBlob.id = previousBlob.id;
				closestBlob.taken = true;
			}
			for (let blob of blobs) {
				if (!blob.taken) {
					blob.generateID();
				}
			}
		} else {
			// More previous blobs than current blobs
			for (let blob of previousBlobs) {
				blob.taken = false;
			}
			for (let blob of blobs) {
				let closestDistanceSq = Infinity;
				let closestIndex = 0;
				const x = blob.centreX;
				const y = blob.centreY;
				for (let i = 0; i < numPrevious; i++) {
					const previousBlob = previousBlobs[i];
					if (!previousBlob.taken) {
						const prevX = previousBlob.centreX;
						const prevY = previousBlob.centreY;
						const dx = x - prevX;
						const dy = y - prevY;
						const distanceSq = dx * dx + dy * dy;
						if (distanceSq < closestDistanceSq) {
							closestIndex = i;
							closestDistanceSq = distanceSq;
						}
					}
				}
				const closestBlob = previousBlobs[closestIndex];
				blob.id = closestBlob.id;
				closestBlob.taken = true;
			}
		}

		context.setTransform(1, 0, 0, 1, 0, 0);
		for (let blob of blobs) {
			context.fillText(blob.id, width - blob.centreX, blob.centreY);
		}
		if (numBlobs < numPrevious) {
			for (let blob of previousBlobs) {
				if (blob.isOffscreen()) {
					blobs.push(blob);
				}
			}
		}
		previousBlobs = blobs;
	}
	lastUpdate = time;
}

async function startCam() {
	const button = document.getElementById('btn-activate-camera');
	button.disabled = true;
	try {
		const stream = await navigator.mediaDevices.getUserMedia({
			video: {
				facingMode: 'user',
				width: {max: 720}
			}
		});
		video.srcObject = stream;
		videoTrack = stream.getVideoTracks()[0];
		videoTrack.applyConstraints({advanced: [
			{whiteBalanceMode: 'manual'},
		]})
		.catch(function (err) {
			console.warn('Unable to disable auto white balance');
		});

		const info = videoTrack.getSettings();
		if (videoTrack.getCapabilities) {
			const capabilities = videoTrack.getCapabilities();

			if (capabilities.exposureCompensation) {
				document.getElementById('cam-gain-row').hidden = false;
				const slider = document.getElementById('cam-gain');
				slider.min = capabilities.exposureCompensation.min;
				slider.max = capabilities.exposureCompensation.max;
				slider.step = capabilities.exposureCompensation.step;
				slider.value = info.exposureCompensation;
			}
			if (capabilities.brightness) {
				document.getElementById('cam-brightness-row').hidden = false;
				const slider = document.getElementById('cam-brightness');
				slider.min = capabilities.brightness.min;
				slider.max = capabilities.brightness.max;
				slider.step = capabilities.brightness.step;
				slider.value = info.brightness;
			}
			if (capabilities.contrast) {
				document.getElementById('cam-contrast-row').hidden = false;
				const slider = document.getElementById('cam-contrast');
				slider.min = capabilities.contrast.min;
				slider.max = capabilities.contrast.max;
				slider.step = capabilities.contrast.step;
				slider.value = info.contrast;
			}
			if (capabilities.colorTemperature) {
				document.getElementById('cam-wb-row').hidden = false;
				const slider = document.getElementById('cam-wb');
				slider.min = capabilities.colorTemperature.min;
				slider.max = capabilities.colorTemperature.max;
				slider.step = capabilities.colorTemperature.step;
				slider.value = info.colorTemperature;
			}
			if (capabilities.saturation) {
				document.getElementById('cam-saturation-row').hidden = false;
				const slider = document.getElementById('cam-saturation');
				slider.min = capabilities.saturation.min;
				slider.max = capabilities.saturation.max;
				slider.step = capabilities.saturation.step;
				slider.value = info.saturation;
			}
			if (capabilities.sharpness) {
				document.getElementById('cam-sharpness-row').hidden = false;
				const slider = document.getElementById('cam-sharpness');
				slider.min = capabilities.sharpness.min;
				slider.max = capabilities.sharpness.max;
				slider.step = capabilities.sharpness.step;
				slider.value = info.sharpness;
			}
		}

		width = info.width;
		height = info.height;
		bytesPerRow = width * 4;
		numBytes = bytesPerRow * height;
		updatePeriod = 1000 / info.frameRate;
		canvas.width = width;
		canvas.height = height;
		offscreenCanvas.width = width;
		offscreenCanvas.height = height;
		offscreenContext.setTransform(-1, 0, 0, 1, width, 0);
		if (backgroundPixels === undefined || backgroundPixels.length !== numBytes) {
			displayData = new ImageData(width, height);
			motionDataSwap = new ImageData(width, height);
			hsiaPixels = new Uint16Array(numBytes);
			previousPixels = new Uint16Array(width * height);
			backgroundPixels = new Uint16Array(numBytes);
		}
		animID = requestAnimationFrame(showWebcam);
		display = parseInt(displaySelector.value);
		button.innerHTML = 'Stop';

		context.filter = filter;
		offscreenContext.filter = filter;
		context.lineWidth = 2;
		context.font = 'bold 20px sans-serif';
		context.textAlign = 'center';
		context.textBaseline = 'middle';
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
	document.getElementById('btn-activate-camera').innerHTML = 'Start';
}

function dilate() {
	const displayPixels = displayData.data;
	const newPixels = motionDataSwap.data;
	let offset = bytesPerRow + 3;
	for (let y = 1; y < height - 1; y++) {
		for (let x = 0; x < width; x++) {
			const aboveOffset = offset - bytesPerRow;
			const belowOffset = offset + bytesPerRow;

			const here = displayPixels[offset];
			const above = displayPixels[aboveOffset];
			const below = displayPixels[belowOffset];

			let left = 0, aboveLeft = 0, belowLeft = 0;
			if (x > 0) {
				left = displayPixels[offset - 4];
				aboveLeft = displayPixels[aboveOffset - 4];
				belowLeft = displayPixels[belowOffset - 4];
			}

			let right = 0, aboveRight = 0, belowRight = 0;
			if (x < width - 1) {
				right = displayPixels[offset + 4];
				aboveRight = displayPixels[aboveOffset + 4];
				belowRight = displayPixels[belowOffset + 4];
			}

			const value = Math.min(here, above, below, left, aboveLeft, belowLeft, right, aboveRight, belowRight);
			newPixels[offset] = value;
			offset += 4;
		}
	}
	const temp = displayData;
	displayData = motionDataSwap;
	motionDataSwap = temp;
}

function setCameraControl(name) {
	return function (event) {
		const constraints = {};
		constraints[name] = parseInt(this.value);
		videoTrack.applyConstraints({
			advanced: [constraints]
		});
	}
}

document.getElementById('cam-gain').addEventListener('input', setCameraControl('exposureCompensation'));
document.getElementById('cam-brightness').addEventListener('input', setCameraControl('brightness'));
document.getElementById('cam-contrast').addEventListener('input', setCameraControl('contrast'));
document.getElementById('cam-wb').addEventListener('input', setCameraControl('colorTemperature'));
document.getElementById('cam-saturation').addEventListener('input', setCameraControl('saturation'));
document.getElementById('cam-sharpness').addEventListener('input', setCameraControl('sharpness'));

canvas.addEventListener('pointerdown', function (event) {
	if (display === Display.MOTION_TRACKER) {
		return;
	}
	if (event.button === 2) {
		display = Display.CAMERA;
		displaySelector.value = Display.CAMERA;
		setDisplay();
		return;
	}
	if (display === Display.CAMERA) {
		display = lastDisplay;
		displaySelector.value = lastDisplay;
		setDisplay();
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
	targetColor = rgbToHSI(red, green, blue);
});

/**
 * Ranges:
 * hue: 0..65535
 * saturation 0..65535
 * intensity 0..765
 */
function rgbToHSI(red, green, blue) {
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const delta = max - min;
	let hue, saturation;
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
	hue *= 65536 / 6;
	const intensity = red + green + blue;
	if (intensity === 0) {
		saturation = 0;
	} else {
		saturation = (1 - (3 * min) / intensity) * 65535;
	}
	return [hue, saturation, intensity];
}

function colorDifference(hue1, saturation1, intensity1, color2) {
	let hueDiff;
	if (saturation1 === 0 || color2[1] === 0) {
		hueDiff = 0;
	} else {
		hueDiff = Math.abs(hue1 - color2[0]);
		if (hueDiff > 32768) {
			hueDiff = 65536 - hueDiff;
		}
	}
	const saturationDiff = Math.abs(saturation1 - color2[1]);
	const intensityDiff = Math.abs(intensity1 - color2[2]);
	return [hueDiff, saturationDiff, intensityDiff];
}

canvas.addEventListener('contextmenu', function (event) {
	event.preventDefault();
});

document.getElementById('hue-threshold').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (display === Display.BACKGROUND_SUBTRACTION) {
		bgHueThreshold = value;
	} else {
		fgHueThreshold = value;
	}
});

document.getElementById('saturation-threshold').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (display === Display.BACKGROUND_SUBTRACTION) {
		bgSaturationThreshold = value;
	} else {
		fgSaturationThreshold = value;
	}
});

document.getElementById('intensity-threshold').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (display === Display.BACKGROUND_SUBTRACTION) {
		bgIntensityThreshold = value;
	} else {
		fgIntensityThreshold = value;
	}
});

document.getElementById('blob-distance-x').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (value > 0) {
		blobDistanceX = value;
	}
});

document.getElementById('blob-distance-y').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (value > 0) {
		blobDistanceY = value;
	}
});

document.getElementById('blob-boundary-percent').addEventListener('input', function (event) {
	const value = parseFloat(this.value);
	if (value >= 50 && value <= 100) {
		boundaryFraction = value / 100;
	}
});

document.getElementById('min-blob-points').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (value > 0) {
		minBlobPoints = value;
	}
});

document.getElementById('blob-max-ttl').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (value > 0) {
		maxTTL = value;
	}
});

document.getElementById('motion-threshold').addEventListener('input', function (event) {
	let value = parseInt(this.value);
	if (value > 0 && value <= 755) {
		motionThreshold = value;
	}
});

const displayControlIDs = [];
displayControlIDs[Display.CAMERA] = 'camera-controls';
displayControlIDs[Display.BACKGROUND_SUBTRACTION] = 'color-match-controls';
displayControlIDs[Display.COLOR_KEY] = 'color-match-controls';
displayControlIDs[Display.BLOBS] = 'blob-controls';
displayControlIDs[Display.MOTION_TRACKER] = 'motion-track-controls';
const allControlSections = ['camera-controls', 'color-match-controls', 'blob-controls', 'motion-track-controls'];

function setDisplay() {
	display = parseInt(displaySelector.value);
	switch (display) {
	case Display.COLOR_KEY:
	case Display.BLOBS:
		lastDisplay = display;
		break;
	case Display.MOTION_TRACKER:
		if (displayData !== undefined) {
			displayData.data.fill(0);
		}
		break;
	}

	const bgSubtractEnable = document.getElementById('subtract-background');
	if (display === Display.BACKGROUND_SUBTRACTION) {
		document.getElementById('hue-threshold').value = bgHueThreshold;
		document.getElementById('saturation-threshold').value = bgSaturationThreshold;
		document.getElementById('intensity-threshold').value = bgIntensityThreshold;
		document.getElementById('subtract-background-controls').hidden = true;
		subtractBackground = true;
	} else {
		document.getElementById('hue-threshold').value = fgHueThreshold;
		document.getElementById('saturation-threshold').value = fgSaturationThreshold;
		document.getElementById('intensity-threshold').value = fgIntensityThreshold;
		document.getElementById('subtract-background-controls').hidden = false;
		subtractBackground = bgSubtractEnable.checked;
	}

	const controlSection = displayControlIDs[display];
	for (let id of allControlSections) {
		document.getElementById(id).hidden = id !== controlSection;
	}
}

displaySelector.addEventListener('input', setDisplay);

document.getElementById('btn-activate-camera').addEventListener('click', async function (event) {
	if (display === Display.STOPPED) {
		await startCam();
	} else {
		stopCam();
	}
});

function setKeyColor(hexColor) {
	keyColor = hexColor;
	keyColorComponents[0] = parseInt(hexColor.substr(1, 2), 16);
	keyColorComponents[1] = parseInt(hexColor.substr(3, 2), 16);
	keyColorComponents[2] = parseInt(hexColor.substr(5, 2), 16);
	context.fillStyle = hexColor;
	context.strokeStyle = hexColor;
}

document.getElementById('color-keying').addEventListener('input', function (event) {
	setKeyColor(this.value);
});

document.getElementById('subtract-background').addEventListener('input', function (event) {
	subtractBackground = this.checked;
});

window.addEventListener('blur', function (event) {
	if (videoTrack) {
		stopCam();
	}
});

function startCapturingBackground() {
	capturingBackground = true;
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.fillText('Computing...', width / 2, height / 2);
}

document.getElementById('btn-capture-background').addEventListener('click', function (event) {
		setTimeout(startCapturingBackground, 3000);
});

document.body.addEventListener('keydown', function (event) {
	if (event.key === ' ') {
		event.preventDefault();
		setTimeout(startCapturingBackground, 3000);
	}
});
