import React, {useState} from 'react';
import {Text, View} from 'react-native';
import TogglePillButton, {type TogglePillButtonProps} from '../../TogglePillButton';

/** Measure the same scaled label without a height constraint before sizing the pill. */
export default function TrainingAction({children, height, ...props}: TogglePillButtonProps) {
  const [measuredHeight, setMeasuredHeight] = useState(44);
  return <View style={{minWidth:0,minHeight:44}}>
    <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      aria-hidden pointerEvents="none"
      onLayout={event=>setMeasuredHeight(Math.ceil(event.nativeEvent.layout.height))}
      style={{opacity:0,fontSize:16,lineHeight:24,fontWeight:'600',textAlign:'center',paddingHorizontal:16,paddingVertical:10,minHeight:44}}>{children}</Text>
    <TogglePillButton {...props} height={Math.max(height??44,measuredHeight)}
      style={{position:'absolute',top:0,left:0,right:0}} textStyle={{fontSize:16,lineHeight:24,fontWeight:'600'}}>{children}</TogglePillButton>
  </View>;
}
