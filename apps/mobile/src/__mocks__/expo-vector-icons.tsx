import React from "react";
import { Text } from "react-native";

export function Ionicons({
  name,
  size,
  color,
  style,
  ...props
}: {
  name: string;
  size?: number;
  color?: string;
  style?: unknown;
  [key: string]: unknown;
}) {
  return (
    <Text {...props} style={[{ fontSize: size, color }, style as object]}>
      {name}
    </Text>
  );
}

export default { Ionicons };
