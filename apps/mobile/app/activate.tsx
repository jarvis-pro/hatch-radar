import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { enrollDevice, isEnrolled, resetEnrollment } from '@/lib/device-identity';
import { hapticError, hapticSuccess } from '@/lib/haptics';
import { loadWorkstationConfig, normalizeBaseUrl, saveWorkstationConfig } from '@/lib/workstation';
import { useRouter } from 'expo-router';
import { CircleAlert, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

/** 设备激活：输入管理员发的一次性激活码 + 工作台地址，换取本机凭据。 */
export default function ActivateScreen() {
  const router = useRouter();
  const saved = loadWorkstationConfig();
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? 'http://192.168.0.95:8787');
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
                placeholder="粘贴管理员发的激活码"
                autoCapitalize="none"
                autoCorrect={false}
                value={code}
                onChangeText={setCode}
                editable={!busy}
              />
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
    </KeyboardAvoidingView>
  );
}
