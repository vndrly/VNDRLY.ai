import amberTop from "@assets/36_AmberV2_Left_R90_1776476149000.png";
import amberMiddle from "@assets/36_AmberV2_Center_R90_1776476149000.png";
import amberBottom from "@assets/36_AmberV2_Right_R90_1776476149000.png";

import blueTop from "@assets/36_BlueV2_Left_R90_1776476149000.png";
import blueMiddle from "@assets/36_BlueV2_Center_R90_1776476149000.png";
import blueBottom from "@assets/36_BlueV2_Right_R90_1776476149000.png";

import greenTop from "@assets/36_GreenV2_Left_R90_1776476149000.png";
import greenMiddle from "@assets/36_GreenV2_Center_R90_1776476149000.png";
import greenBottom from "@assets/36_GreenV2_Right_R90_1776476149000.png";

import redTop from "@assets/36_RedV2_Left_R90_1776476149000.png";
import redMiddle from "@assets/36_RedV2_Center_R90_1776476149000.png";
import redBottom from "@assets/36_RedV2_Right_R90_1776476149000.png";

import greyTop from "@assets/36_LightGreyV2_Left_R90_1776476149000.png";
import greyMiddle from "@assets/36_LightGreyV2_Center_R90_1776476149000.png";
import greyBottom from "@assets/36_LightGreyV2_Right_R90_1776476149000.png";

import type { PillColor } from "@/components/status-pill-assets";

export const verticalPillMap: Record<PillColor, { top: string; middle: string; bottom: string }> = {
  amber: { top: amberTop, middle: amberMiddle, bottom: amberBottom },
  blue: { top: blueTop, middle: blueMiddle, bottom: blueBottom },
  green: { top: greenTop, middle: greenMiddle, bottom: greenBottom },
  red: { top: redTop, middle: redMiddle, bottom: redBottom },
  grey: { top: greyTop, middle: greyMiddle, bottom: greyBottom },
};

export const VERTICAL_PILL_CAP_PX = 8;
