import React from 'react';
import { Image } from 'react-native';
import type { ShieldStatus } from '@workspace/api-zod/profile-status';
const files = {
  green: require('../assets/images/agreement-accepted.png'),
  yellow: require('../assets/images/status-shield-yellow.png'),
  red: require('../assets/images/status-shield-red.png'),
  grey: require('../assets/images/status-shield-grey.png'),
};
export default function StatusShield({ status, label }: { status: ShieldStatus; label: string }) {
  return <Image source={files[status]} accessibilityLabel={label} testID={`status-shield-${status}`} style={{ width: 24, height: 24 }} resizeMode="contain" />;
}
