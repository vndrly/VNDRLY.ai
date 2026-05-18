import amberLeft from "@assets/36_Amber_Pill_Left_1776771105809.png";
import amberCenter from "@assets/36_Amber_Pill_Center_1776771105808.png";
import amberRight from "@assets/36_Amber_Pill_Right_1776771105809.png";

import blueLeft from "@assets/36_Blue_Pill_Left_1776771105812.png";
import blueCenter from "@assets/36_Blue_Pill_Center_1776771105811.png";
import blueRight from "@assets/36_Blue_Pill_Right_1776771105812.png";

import greenLeft from "@assets/36_Green_Pill_Left_1776771105803.png";
import greenCenter from "@assets/36_Green_Pill_Center_1776771105802.png";
import greenRight from "@assets/36_Green_Pill_Right_1776771105804.png";

import redLeft from "@assets/36_Red_Pill_Left_1776771105807.png";
import redCenter from "@assets/36_Red_Pill_Center_1776771105806.png";
import redRight from "@assets/36_Red_Pill_Right_1776771105808.png";

import greyLeft from "@assets/36_LightGrey_Pill_Left_1776771105805.png";
import greyCenter from "@assets/36_LightGrey_Pill_Center_1776771105804.png";
import greyRight from "@assets/36_LightGrey_Pill_Right_1776771105806.png";

export type PillColor = "amber" | "blue" | "green" | "red" | "grey";

export const pillColorMap: Record<PillColor, { left: string; center: string; right: string }> = {
  amber: { left: amberLeft, center: amberCenter, right: amberRight },
  blue: { left: blueLeft, center: blueCenter, right: blueRight },
  green: { left: greenLeft, center: greenCenter, right: greenRight },
  red: { left: redLeft, center: redCenter, right: redRight },
  grey: { left: greyLeft, center: greyCenter, right: greyRight },
};

export const PILL_SLICE_WIDTH_PX = 8;
