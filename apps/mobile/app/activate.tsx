import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { enrollDevice, isEnrolled, resetEnrollment } from '@/lib/device-identity';
import { hapticError, hapticSuccess } from '@/lib/haptics';
import { loadWorkstationConfig, normalizeBaseUrl, saveWorkstationConfig } from '@/lib/workstation';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { CircleAlert, ScanLine, ShieldCheck, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** 设备激活：输入管理员发的一次性激活码 + 工作台地址，换取本机凭据。 */
export default function ActivateScreen() {
  const router = useRouter();
  const saved = loadWorkstationConfig();
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? 'http://192.168.0.95:8787');
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const enrolled = isEnrolled();

  const onActivate = async () => {
    setError(null);
    setBusy(true);
    try {
      const url = normalizeBaseUrl(baseUrl);
      saveWorkstationConfig({ baseUrl: url });
      await enrollDevice(url, code, deviceName.trim() || '移动设备');
      hapticSuccess();
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      hapticError();
    } finally {
      setBusy(false);
    }
  };

  // 扫码：先确保相机权限，再开取景框；扫到的二维码内容即激活码原文，直接回填
  const openScanner = async () => {
    setError(null);
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setError('需要相机权限才能扫码，可在系统设置中开启后重试。');

        return;
      }
    }

    scannedRef.current = false;
    setScanning(true);
  };

  const onScanned = (data: string) => {
    if (scannedRef.current) {
      return;
    } // 取景中会连续回调，只取首帧

    scannedRef.current = true;
    setCode(data.trim());
    setScanning(false);
    hapticSuccess();
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="gap-3 p-4 pb-10" keyboardShouldPersistTaps="handled">
        <Card className="gap-4 py-4 shadow-none">
          <CardHeader className="gap-1 px-4">
            <CardTitle>激活设备</CardTitle>
            <CardDescription className="leading-5">
              向管理员索取一次性激活码（web 控制台「账户管理 →
              管理设备」生成）。激活后本机以你的账户身份同步，权限随账户、可被远程强踢。
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-3 px-4">
            {enrolled ? (
              <View className="flex-row items-start gap-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
                <Icon as={ShieldCheck} size={16} className="mt-0.5 text-success" />
                <Text className="flex-1 text-sm leading-5 text-success">
                  本机已激活。重新激活会用新激活码替换当前凭据。
                </Text>
              </View>
            ) : null}
            <View className="gap-1.5">
              <Label>工作台地址</Label>
              <Input
                placeholder="http://192.168.0.95:8787"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={baseUrl}
                onChangeText={setBaseUrl}
                editable={!busy}
              />
            </View>
            <View className="gap-1.5">
              <Label>激活码</Label>
              <Input
                className="font-mono"
                placeholder="粘贴或扫码填入激活码"
                autoCapitalize="none"
                autoCorrect={false}
                value={code}
                onChangeText={setCode}
                editable={!busy}
              />
              <Button variant="outline" size="sm" onPress={openScanner} disabled={busy}>
                <Icon as={ScanLine} size={16} />
                <Text>扫码填充</Text>
              </Button>
            </View>
            <View className="gap-1.5">
              <Label>设备名（可选）</Label>
              <Input
                placeholder="如：我的 iPad"
                value={deviceName}
                onChangeText={setDeviceName}
                editable={!busy}
              />
            </View>
            <Button onPress={onActivate} disabled={busy || !code.trim()}>
              <Icon as={ShieldCheck} size={16} className="text-primary-foreground" />
              <Text>{busy ? '激活中…' : enrolled ? '重新激活' : '激活'}</Text>
            </Button>
            {enrolled ? (
              <Button
                variant="outline"
                onPress={() => {
                  resetEnrollment();
                  router.back();
                }}
                disabled={busy}
              >
                <Text>解除本机激活</Text>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        {error ? (
          <View className="flex-row items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
            <Icon as={CircleAlert} size={16} className="mt-0.5 text-destructive" />
            <Text className="flex-1 text-sm leading-5 text-destructive">{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      <QrScanner visible={scanning} onClose={() => setScanning(false)} onScanned={onScanned} />
    </KeyboardAvoidingView>
  );
}

/** 全屏二维码取景：扫到即回调（父级 scannedRef 去抖），右上角关闭。 */
function QrScanner({
  visible,
  onClose,
  onScanned,
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (data: string) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        {visible ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => onScanned(data)}
          />
        ) : null}
        <View style={{ position: 'absolute', top: insets.top + 8, right: 16 }}>
          <Pressable
            accessibilityLabel="关闭扫码"
            hitSlop={10}
            onPress={onClose}
            className="h-10 w-10 items-center justify-center rounded-full bg-black/50"
          >
            <Icon as={X} size={22} className="text-white" />
          </Pressable>
        </View>
        <View
          style={{ position: 'absolute', bottom: insets.bottom + 48, left: 0, right: 0 }}
          className="items-center px-10"
        >
          <View className="rounded-full bg-black/50 px-4 py-2">
            <Text className="text-center text-sm text-white">将激活码二维码对准取景框</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}
