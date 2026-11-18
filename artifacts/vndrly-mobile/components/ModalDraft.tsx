import React, {createContext, forwardRef, useContext, useId, useRef, useEffect} from "react";
import {TextInput, Pressable, type TextInputProps, type PressableProps} from "react-native";

export const ModalDraftContext = createContext<{mark: (id: string, dirty: boolean) => void; touch: () => void; dismiss: (action: () => void) => void} | null>(null);
export type ModalTextInput = TextInput;
export const ModalTextInput = forwardRef<TextInput, TextInputProps>(function ModalTextInput(props, ref) {
  const context = useContext(ModalDraftContext), id = useId();
  const baseline = useRef(props.value ?? props.defaultValue ?? ""), edited = useRef(false);
  if (!edited.current) baseline.current = props.value ?? props.defaultValue ?? "";
  useEffect(() => () => context?.mark(id, false), [context, id]);
  return <TextInput {...props} ref={ref} onChangeText={text => {
    context?.touch();
    edited.current = text !== baseline.current;
    context?.mark(id, edited.current); props.onChangeText?.(text);
  }} />;
});
function textOf(node: React.ReactNode): string {
  return React.Children.toArray(node).map(child => typeof child === "string" ? child : React.isValidElement<{children?:React.ReactNode}>(child) ? textOf(child.props.children) : "").join(" ");
}
/** Existing custom Cancel/Close buttons obey the same guard as the modal chrome. */
export const ModalPressable = forwardRef<React.ElementRef<typeof Pressable>, PressableProps>(function ModalPressable(props, ref) {
  const context = useContext(ModalDraftContext);
  const label = props.accessibilityLabel ?? (typeof props.children === "function" ? "" : textOf(props.children));
  return <Pressable {...props} ref={ref} onPress={event => {
    context?.touch();
    if (context && /^(cancel|close|cerrar|cancelar)\b/i.test(label.trim())) context.dismiss(() => props.onPress?.(event));
    else props.onPress?.(event);
  }} />;
});
