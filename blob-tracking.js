'use strict';

const video = document.getElementById('webcam');
const canvas = document.getElementById('camera-canvas');
const context = canvas.getContext('2d');
const offscreenCanvas = document.createElement('CANVAS');
const offscreenContext = offscreenCanvas.getContext('2d');
const bell = document.getElementById('bell');
let display = parseInt(document.getElementById('camera-display').value);
let displayEnabled = false;
let capturingBackground = false;
let lastUpdate = 0;
let numBackgroundFrames = 50;
let numPreviousFrames = 4;
let motionThreshold = parseInt(document.getElementById('motion-threshold').value);
let blobDistanceX = parseInt(document.getElementById('blob-distance').value);
let boundaryFraction = parseFloat(document.getElementById('blob-boundary-percent').value) / 100;
let minBlobPoints = parseInt(document.getElementById('min-blob-points').value);
let maxTTL = parseInt(document.getElementById('blob-max-ttl').value);
let videoTrack, width, height, bytesPerRow, numBytes, updatePeriod, animID;
let motionImageData, backgroundFrames = [], backgroundPixels, previousPixels, sumPixels;
let frameIndex = 0;
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
			this.left = x;
			this.bottom = y;
		}
		this.xCoordsOnRow.push(x);
	}

	finalizeRow() {
		const coordsOnRow = this.xCoordsOnRow;
		const numCoords = coordsOnRow.length;
		const lb = Math.trunc((numCoords - 1) * (1 - boundaryFraction));
		const ub = Math.trunc((numCoords - 1) * boundaryFraction);
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
		let intersectingPoints = 0;
		do {
			const left = leftPoints[j];
			const left2 = leftPoints2[j2];
			const right = rightPoints[j];
			const right2 = rightPoints2[j2];
			if (right >= left2 && left <= right2) {
				canMerge = true;
				newLeft.push(left);
				newRight.push(right2);
				intersectingPoints += right - left2;
			} else if (right2 >= left && left2 <= right) {
				canMerge = true;
				newLeft.push(left2);
				newRight.push(right);
				intersectingPoints += right2 - left;
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
		if (id < 3 && this.maxRight >= width * 0.67) {
			while (id < 3 || BlobShape.activeIDs.has(id)) {
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
	MOTION_TRACKER: 2,
	BLOBS: 3,
});

function showWebcam(time) {
	animID = requestAnimationFrame(showWebcam);
	if (time - lastUpdate < updatePeriod) {
		return;
	}
	context.setTransform(-1, 0, 0, 1, width, 0);
	if (display !== Display.MOTION_TRACKER) {
		context.drawImage(video, 0, 0);
	}

	offscreenContext.drawImage(video, 0, 0);
	const imageData = offscreenContext.getImageData(0, 0, width, height);
	const pixels = imageData.data;

	if (capturingBackground) {
		backgroundFrames.push(pixels);
		if (backgroundFrames.length === numBackgroundFrames) {
			bell.play();
			const medianFrame = new Uint8ClampedArray(width * height * 4);
			const midIndex = Math.trunc((numBackgroundFrames - 1) * 0.5);
			for (let i = 0; i < numBytes; i++) {
				const values = new Uint8ClampedArray(numBackgroundFrames);
				for (let j = 0; j < numBackgroundFrames; j++) {
					values[j] = backgroundFrames[j][i];
				}
				values.sort();
				medianFrame[i] = values[midIndex];
			}
			backgroundFrames = [];
			for (let i = 0; i < numBytes; i += 4) {
				backgroundPixels[i / 4] = intensity(medianFrame, i);
			}
			capturingBackground = false;
		} else {
			return;
		}
	}

	if (display === Display.CAMERA) {
		return;
	}

	const framePixels = previousPixels[frameIndex];
	const motionImagePixels = motionImageData.data;
	const blobs = [];

	for (let i = 0; i < numBytes; i += 4) {
		const pixelNum = i / 4;

		const difference = Math.abs(intensity(pixels, i) - backgroundPixels[pixelNum]);
		let sum = sumPixels[pixelNum];
		sum -= framePixels[pixelNum];
		sum += difference;
		sumPixels[pixelNum] = sum;
		framePixels[pixelNum] = difference;
		const motionMatch = sum >= motionThreshold;

		if (motionMatch) {
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
		}

		if (display === Display.MOTION_TRACKER) {
			motionImagePixels[i + 3] = motionMatch ? 0 : 255;	// Set alpha
		}

	}

	frameIndex = (frameIndex + 1) % numPreviousFrames;
	lastUpdate = time;

	if (display === Display.MOTION_TRACKER) {
		context.putImageData(motionImageData, 0, 0);
		return;
	}

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

	let i = 0;
	while (i < blobs.length) {
		const blob = blobs[i];
		if (blob.numPoints >= minBlobPoints) {
			i++;
		} else {
			blobs.splice(i, 1);
		}
	}
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

async function startCam() {
	const button = document.getElementById('camera-activation');
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
		backgroundPixels = new Uint16Array(width * height);
		previousPixels = [];
		for (let i = 0; i < numPreviousFrames; i++) {
			previousPixels.push(new Uint16Array(width * height));
		}
		sumPixels = new Uint16Array(width * height);
		motionImageData = new ImageData(width, height);
		animID = requestAnimationFrame(showWebcam);
		displayEnabled = true;
		button.innerHTML = 'Stop';

		context.lineWidth = 2;
		context.font = 'bold 20px sans-serif';
		context.textAlign = 'center';
		context.textBaseline = 'middle';

		// TODO if width or height have changed and motion is displayed then reallocate motionImageData.
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
	displayEnabled = false;
	document.getElementById('camera-activation').innerHTML = 'Start';
}

function intensity(pixels, index) {
	const red = pixels[index];
	const green = pixels[index + 1];
	const blue = pixels[index + 2];
	return red + green + blue;
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

document.getElementById('blob-distance').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (value > 0) {
		blobDistanceX = value;
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

const displayControlIDs = [];
displayControlIDs[Display.CAMERA] = 'camera-controls';
displayControlIDs[Display.MOTION_TRACKER] = 'motion-track-controls';
displayControlIDs[Display.BLOBS] = 'blob-controls';
const allControlSections = ['camera-controls', 'motion-track-controls', 'blob-controls'];

document.getElementById('camera-display').addEventListener('input', function (event) {
	display = parseInt(this.value);
	const controlSection = displayControlIDs[display];
	for (let id of allControlSections) {
		document.getElementById(id).hidden = id !== controlSection;
	}
});


document.getElementById('camera-activation').addEventListener('click', async function (event) {
	if (displayEnabled) {
		stopCam();
	} else {
		await startCam();
	}
});

document.getElementById('camera-bg-capture').addEventListener('click', function (event) {
	capturingBackground = true;
});

document.getElementById('motion-threshold').addEventListener('input', function (event) {
	const value = parseInt(this.value);
	if (value > 0) {
		motionThreshold = value;
	}
});

window.addEventListener('blur', function (event) {
	if (videoTrack) {
		stopCam();
	}
});
