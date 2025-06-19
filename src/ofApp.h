#pragma once

#include "ofMain.h"

class ofApp : public ofBaseApp {
public:
	void setup();
	void draw();
	void mousePressed(int x, int y, int button);

	bool showCircle = false;
	float circleX, circleY;
};
