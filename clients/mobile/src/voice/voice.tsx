import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioStream,
  type AudioPlayer,
  type AudioSource,
} from 'expo-audio';
import { Pause, Play } from '../ui/icons';
import { allowIn } from '../connection/permissions';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import type { Recording } from '../chat/chat-state';
import { wavBars, wavSeconds } from './waveform';
import { dropRecording } from './pending-voice';
import { font, radius, type Theme } from '../ui/theme';
import { errorText, fetchWithin } from '../connection/api';

const playback = { allowsRecording: false, playsInSilentMode: true };
let playingNow: AudioPlayer | null = null;
let recordingNow = false;

export function clock(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function loudness(data: ArrayBuffer | ArrayBufferView) {
  const samples = ArrayBuffer.isView(data)
    ? new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2))
    : new Int16Array(data, 0, Math.floor(data.byteLength / 2));
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) {
    const value = sample / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

const floorLevel = 0.06;
const barCount = 40;

export function useVoiceRecorder() {
  const recent = useRef<number[]>([]);
  const peak = useRef(0.02);
  const recording = useRef(false);
  const { stream } = useAudioStream({
    sampleRate: 16000,
    channels: 1,
    encoding: 'int16',
    onBuffer: (buffer) => {
      if (!recording.current) return;
      const value = loudness(buffer.data);
      peak.current = Math.max(value, peak.current * 0.985, 0.012);
      const bar = Math.min(1, Math.max(floorLevel, Math.sqrt(value / peak.current)));
      recent.current = [...recent.current.slice(-(barCount - 1)), bar];
    },
  });
  const [active, setActive] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string>();
  const busy = useRef(false);
  const started = useRef(0);
  const live = useRef(false);
  live.current = active;

  useEffect(
    () => () => {
      if (!live.current) return;
      recordingNow = false;
      void stream
        .stopFileRecordingAsync()
        .then((file) => dropRecording(file.uri, true))
        .catch(() => {})
        .finally(() => {
          try {
            if (stream.isStreaming) stream.stop();
          } catch {}
          void setAudioModeAsync(playback).catch(() => {});
        });
    },
    [stream],
  );

  useEffect(() => {
    if (!active) return;
    recording.current = true;
    const timer = setInterval(() => {
      setSeconds((Date.now() - started.current) / 1000);
      setLevels(recent.current);
    }, 100);
    return () => {
      recording.current = false;
      clearInterval(timer);
    };
  }, [active]);

  async function start() {
    if (busy.current || active) return;
    busy.current = true;
    setError(undefined);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError(`Nod needs the microphone to record. ${allowIn}`);
        return;
      }
      recordingNow = true;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await stream.start();
      await stream.startFileRecordingAsync({ format: 'wav' });
      started.current = Date.now();
      recent.current = [];
      peak.current = 0.02;
      setSeconds(0);
      setLevels([]);
      setActive(true);
    } catch (problem) {
      if (stream.isStreaming) stream.stop();
      recordingNow = false;
      await setAudioModeAsync(playback).catch(() => {});
      setError(`Recording did not start: ${errorText(problem)}`);
    } finally {
      busy.current = false;
    }
  }

  async function stop(keep = true): Promise<Recording | null> {
    if (busy.current || !active) return null;
    busy.current = true;
    try {
      const file = await stream.stopFileRecordingAsync();
      stream.stop();
      recordingNow = false;
      await setAudioModeAsync(playback);
      if (!keep) {
        dropRecording(file.uri, true);
        return null;
      }
      if (file.duration < 0.6) {
        dropRecording(file.uri, true);
        setError('That recording was too short to send. Record for at least a second.');
        return null;
      }
      return {
        uri: file.uri,
        mimeType: 'audio/wav',
        name: 'voice.wav',
        durationMillis: Math.round(file.duration * 1000),
      };
    } catch (problem) {
      if (stream.isStreaming) stream.stop();
      await setAudioModeAsync(playback).catch(() => {});
      setError(`Recording did not stop cleanly: ${errorText(problem)}`);
      return null;
    } finally {
      recordingNow = false;
      setActive(false);
      busy.current = false;
    }
  }

  return {
    active,
    seconds,
    levels,
    error,
    clearError: () => setError(undefined),
    start,
    finish: () => stop(true),
    cancel: () => void stop(false),
  };
}

export function Levels({
  levels,
  theme,
  height = 24,
}: {
  levels: number[];
  theme: Theme;
  height?: number;
}) {
  const padded = [...Array(Math.max(0, barCount - levels.length)).fill(floorLevel), ...levels];
  return (
    <View style={[styles.levels, { height }]} importantForAccessibility="no-hide-descendants">
      {padded.map((level, index) => (
        <View
          key={index}
          style={[
            styles.level,
            {
              height: Math.max(3, level * height),
              backgroundColor: theme.secondary,
              opacity: 0.85,
            },
          ]}
        />
      ))}
    </View>
  );
}

const waves = new Map<string, Promise<{ bars: number[] | null; seconds: number | null }>>();

function loadWave(source: AudioSource) {
  const uri =
    typeof source === 'string'
      ? source
      : source && typeof source === 'object'
        ? source.uri
        : undefined;
  if (!uri) return null;
  let pending = waves.get(uri);
  if (!pending) {
    const headers =
      typeof source === 'object' && source && 'headers' in source ? source.headers : undefined;
    pending = (
      uri.startsWith('file:')
        ? new File(uri).bytes()
        : fetchWithin(uri, { headers }).then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return new Uint8Array(await response.arrayBuffer());
          })
    )
      .then((bytes) => ({ bars: wavBars(bytes, barCount), seconds: wavSeconds(bytes) }))
      .catch(() => {
        waves.delete(uri);
        return { bars: null, seconds: null };
      });
    waves.set(uri, pending);
  }
  return pending;
}

function useWave(source: AudioSource, mimeType: string | undefined, size: number | undefined) {
  const [wave, setWave] = useState<{ bars: number[] | null; seconds: number | null }>();
  const wav = /^audio\/(wav|x-wav|wave|vnd\.wave)$/i.test(mimeType ?? '');
  const small = size === undefined || size <= 10 * 1024 * 1024;
  const key =
    typeof source === 'string' ? source : source && typeof source === 'object' ? source.uri : '';
  useEffect(() => {
    if (!wav || !small) return;
    let active = true;
    void loadWave(source)?.then((value) => {
      if (active) setWave(value);
    });
    return () => {
      active = false;
    };
  }, [key, wav, small]);
  return wave;
}

export function AudioClip({
  source,
  durationMillis,
  mimeType,
  size,
  theme,
  onBubble,
}: {
  source: AudioSource;
  durationMillis?: number;
  mimeType?: string;
  size?: number;
  theme: Theme;
  onBubble?: boolean;
}) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  useEffect(
    () => () => {
      if (playingNow === player) playingNow = null;
    },
    [player],
  );
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const wave = useWave(source, mimeType, size);
  const duration =
    status.duration > 0 ? status.duration : (durationMillis ?? 0) / 1000 || wave?.seconds || 0;
  const progress = duration > 0 ? Math.min(status.currentTime / duration, 1) : 0;
  const ended = status.didJustFinish || (duration > 0 && status.currentTime >= duration - 0.05);

  async function toggle() {
    setError(undefined);
    try {
      if (!status.playing && !recordingNow) await setAudioModeAsync(playback);
      if (status.playing) return player.pause();
      if (playingNow && playingNow !== player) playingNow.pause();
      playingNow = player;
      if (!loaded) {
        player.replace(source);
        setLoaded(true);
        player.play();
        return;
      }
      if (ended) void player.seekTo(0);
      player.play();
    } catch (problem) {
      setError(`Playback failed: ${errorText(problem)}`);
    }
  }

  return (
    <View style={styles.clipWrap}>
      <View style={styles.clip}>
        <Pressable
          onPress={toggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause voice message' : 'Play voice message'}
          style={({ pressed }) => [
            styles.play,
            { backgroundColor: pressed ? theme.playPressed : theme.play },
          ]}
        >
          {status.playing ? (
            <Pause size={16} color={theme.foreground} fill={theme.foreground} />
          ) : (
            <Play size={16} color={theme.foreground} solid />
          )}
        </Pressable>
        <View style={styles.fill}>
          {wave?.bars ? (
            <View style={styles.wave} importantForAccessibility="no-hide-descendants">
              {wave.bars.map((bar, index) => {
                const played = (index + 0.5) / wave.bars!.length <= progress;
                return (
                  <View
                    key={index}
                    style={[
                      styles.waveBar,
                      {
                        height: Math.max(3, bar * 24),
                        backgroundColor: played ? theme.secondary : theme.mutedForeground,
                        opacity: played ? 1 : 0.4,
                      },
                    ]}
                  />
                );
              })}
            </View>
          ) : (
            <View style={[styles.track, { backgroundColor: onBubble ? theme.inset : theme.muted }]}>
              <View
                style={[
                  styles.progress,
                  { width: `${progress * 100}%`, backgroundColor: theme.secondary },
                ]}
              />
            </View>
          )}
        </View>
        <Text style={[styles.time, { color: theme.mutedForeground }]}>
          {status.playing || (loaded && status.currentTime > 0 && !ended)
            ? clock(status.currentTime)
            : duration
              ? clock(duration)
              : '–:––'}
        </Text>
      </View>
      {error || status.error ? (
        <Text style={[styles.error, { color: theme.error }]}>
          {error ?? `Playback failed: ${status.error}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  levels: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, overflow: 'hidden' },
  level: { flex: 1, borderRadius: radius.full },
  clipWrap: { gap: 4, minWidth: 220 },
  clip: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  play: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wave: { height: 24, flexDirection: 'row', alignItems: 'center', gap: 2 },
  waveBar: { flex: 1, borderRadius: radius.full },
  track: { height: 4, borderRadius: radius.full, overflow: 'hidden' },
  progress: { height: 4, borderRadius: radius.full },
  time: {
    fontFamily: font.medium,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 32,
    textAlign: 'right',
  },
  error: { fontFamily: font.regular, fontSize: 12 },
});
