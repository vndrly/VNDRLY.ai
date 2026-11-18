import { ModalPressable as Pressable } from "@/components/ModalDraft";
import React from 'react';
import { Text} from "react-native";
import {useColors} from '@/hooks/useColors';

/** Answers grow with their text and Dynamic Type; they must never be clipped. */
export default function TrainingChoice({label, selected, multiple, disabled, onPress}: {
  label: string; selected: boolean; multiple: boolean; disabled: boolean; onPress: () => void;
}) {
  const colors = useColors();
  return <Pressable accessibilityRole={multiple ? 'checkbox' : 'radio'}
    accessibilityLabel={label} accessibilityState={{checked: selected, disabled}}
    aria-checked={selected} aria-disabled={disabled}
    disabled={disabled} onPress={onPress}
    style={{minHeight: 44, padding: 12, borderRadius: 12, borderWidth: selected ? 2 : 1,
      borderColor: selected ? colors.primary : colors.text, backgroundColor: colors.card,
      flexDirection: 'row', alignItems: 'flex-start', gap: 10, opacity: disabled ? 0.65 : 1}}>
    <Text accessible={false} style={{color: colors.primary, fontSize: 18}}>{selected ? '✓' : multiple ? '□' : '○'}</Text>
    <Text style={{color: colors.text, fontSize: 16, lineHeight: 24, flex: 1, minWidth: 0}}>{label}</Text>
  </Pressable>;
}
