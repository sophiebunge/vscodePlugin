#include "ofApp.h"

void ofApp::setup() {
	ofBackground(0); // black background
}

void ofApp::draw() {
	if (showCircle) {
		ofSetColor(255, 100, 100); // soft red
		ofDrawCircle(circleX, circleY, 30); // draw a circle
	}
}

void ofApp::mousePressed(int x, int y, int button) {
	circleX = x;
	circleY = y;
	showCircle = true;
}
