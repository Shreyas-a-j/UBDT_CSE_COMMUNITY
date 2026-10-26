import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Type } from '@/lib/theme';

/**
 * Immersive, full-screen announcement image viewer.
 *
 * The feed keeps every image uncropped; this viewer is where a member can see
 * the original at the largest size the screen allows. Horizontal paging moves
 * between the announcement's images.
 */
export function AnnouncementImageViewer({
  urls,
  title,
  initialIndex,
  visible,
  onClose,
}: {
  urls: string[];
  title: string;
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [index, setIndex] = useState(initialIndex);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});

  if (urls.length === 0) return null;

  const showAt = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(nextIndex, urls.length - 1));
    setIndex(clamped);
    scrollRef.current?.scrollTo({ x: clamped * width, animated: false });
  };

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
    setIndex(Math.max(0, Math.min(nextIndex, urls.length - 1)));
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onShow={() => showAt(initialIndex)}
    >
      <View style={styles.root} accessibilityViewIsModal>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          bounces={false}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleMomentumEnd}
          contentOffset={{ x: initialIndex * width, y: 0 }}
        >
          {urls.map((uri, imageIndex) => (
            <View key={`${uri}-${imageIndex}`} style={{ width, height }}>
              <Image
                source={{ uri }}
                style={styles.image}
                resizeMode="contain"
                onLoadEnd={() =>
                  setLoaded((previous) =>
                    previous[imageIndex] ? previous : { ...previous, [imageIndex]: true }
                  )
                }
                accessibilityLabel={`${title}, image ${imageIndex + 1} of ${urls.length}, full screen`}
              />
            </View>
          ))}
        </ScrollView>

        {!loaded[index] ? (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        ) : null}

        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close image viewer"
          style={({ pressed }) => [
            styles.close,
            { top: insets.top + 8 },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>

        {urls.length > 1 ? (
          <View
            style={[styles.counter, { bottom: insets.bottom + 18 }]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={`Image ${index + 1} of ${urls.length}`}
          >
            <Text style={styles.counterText}>
              {index + 1} / {urls.length}
            </Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  close: {
    position: 'absolute',
    right: 14,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  counterText: {
    fontFamily: Type.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.3,
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.6,
  },
});
