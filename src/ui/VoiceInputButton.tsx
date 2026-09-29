import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton, Sheet, Button, Text, useAnnounce } from "./components";
import { isVoiceInputAvailable, startListening, stopListening, type VoiceEvent } from "../voice/VoiceInput";

interface Props {
  disabled?: boolean;
  onTranscript: (text: string) => void;
}

// The recognizer caveat is shown once per app run (no settings key for it yet).
let caveatShown = false;

/**
 * Mic button for the composer. Backed by the system SpeechRecognizer
 * (src/voice/VoiceInput.ts), which may use the network and is often missing
 * on GrapheneOS / de-Googled builds: when it's missing the button isn't shown,
 * and the first use explains that it may not be offline.
 */
export function VoiceInputButton({ disabled, onTranscript }: Props) {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [caveatOpen, setCaveatOpen] = useState(false);

  useEffect(() => {
    isVoiceInputAvailable().then(setAvailable).catch(() => setAvailable(false));
  }, []);

  if (!available) return null;

  const listen = async () => {
    setListening(true);
    announce(t("chat.announce.listening"));
    try {
      const result = await startListening((event: VoiceEvent) => {
        if (event.type === "error") setListening(false);
      });
      if (result) onTranscript(result);
    } finally {
      setListening(false);
      announce(t("chat.announce.stoppedListening"));
    }
  };

  const onPress = async () => {
    if (listening) {
      await stopListening();
      setListening(false);
      return;
    }
    if (!caveatShown) {
      caveatShown = true;
      setCaveatOpen(true);
      return;
    }
    listen();
  };

  return (
    <>
      <IconButton
        icon="mic"
        label={listening ? t("chat.voice.stop") : t("chat.voice.start")}
        variant={listening ? "filled" : "plain"}
        selected={listening}
        disabled={disabled && !listening}
        onPress={onPress}
      />
      <Sheet
        visible={caveatOpen}
        onClose={() => setCaveatOpen(false)}
        title={t("chat.voice.caveatTitle")}
        footer={
          <Button
            label={t("chat.voice.caveatOk")}
            fullWidth
            onPress={() => {
              setCaveatOpen(false);
              listen();
            }}
          />
        }
      >
        <Text color="secondary">{t("chat.voice.caveatBody")}</Text>
      </Sheet>
    </>
  );
}
