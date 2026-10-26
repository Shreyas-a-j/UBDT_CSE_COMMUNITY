import { useMemo } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { parseLinks } from '@/lib/feed-logic';
import { Brand } from '@/lib/theme';

/**
 * Plain text with every validated http(s) URL rendered as a tappable run.
 * Mirrors the website's `LinkifiedText`: no HTML is parsed, unsafe schemes are
 * rejected by `parseLinks`, and all other text (line breaks included) is kept
 * byte-for-byte.
 */
export function LinkifiedText({
  text,
  style,
  linkStyle,
  numberOfLines,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const tokens = useMemo(() => parseLinks(text), [text]);

  const open = (event: GestureResponderEvent, href: string) => {
    event.stopPropagation?.();
    Linking.openURL(href).catch(() => undefined);
  };

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {tokens.map((token, index) =>
        token.type === 'link' ? (
          <Text
            key={`link-${index}`}
            accessibilityRole="link"
            accessibilityLabel={`Open ${token.label}`}
            onPress={(event) => open(event, token.href)}
            style={[styles.link, linkStyle]}
          >
            {token.label}
          </Text>
        ) : (
          token.value
        )
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: {
    color: Brand.accent,
    textDecorationLine: 'underline',
  },
});
