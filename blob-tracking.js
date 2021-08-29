const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
let targetRed = 0, targetGreen = 0, targetBlue = 0;
let sampleSize = 1;
let lastUpdate = 0;
let colorThreshold = 50;
let width, height, numBytes, updatePeriod;

function showWebcam(time) {
	if (time - lastUpdate < updatePeriod) {
		requestAnimationFrame(showWebcam);
		return;
	}
	context.drawImage(video, 0, 0);
	const imageData = context.getImageData(0, 0, width, height);
	const pixels = imageData.data;
	for (let i = 0; i < numBytes; i += 4) {
		const redDiff = Math.abs(pixels[i] - targetRed);
		const greenDiff = Math.abs(pixels[i + 1] - targetGreen);
		const blueDiff = Math.abs(pixels[i + 2] - targetBlue);
		const diff = redDiff + greenDiff + blueDiff;
		if (diff <= colorThreshold) {
			pixels[i] = 255;
			pixels[i + 1] = 0;
			pixels[i + 2] = 255;
		}
	}
	context.putImageData(imageData, 0, 0);

	lastUpdate = time;
	requestAnimationFrame(showWebcam);
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

canvas.addEventListener('click', function (event) {
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
	const pixels = context.getImageData(minX, minY, sampleWidth, sampleHeight).data;
	let red = 0, green = 0, blue = 0;
	for (let i = 0; i < numSampleBytes; i += 4) {
		red += pixels[i];
		green += pixels[i + 1];
		blue += pixels[i + 2];
	}
	targetRed = red / numPixels;
	targetGreen = green / numPixels;
	targetBlue = blue / numPixels;
});
