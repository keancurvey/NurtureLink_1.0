import { useEffect, useRef } from 'react';
import { ImagePlus, Send, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGearOffset } from '../presenter/useGearOffset.js';
import ChatPhoto from './ChatPhoto.jsx';

const MAX_ROWS_REM = 8;

/**
 * The message box at the foot of a chat (PAT-C-02, PAT-C-06). It sits above the tab bar and reports its height so the gear
 * moves above it. Controlled by the screen: the text, the attachment ({ url } from her own phone or { art } a drawn picture),
 * and what is wrong. The picker takes a photo from her own phone; nothing asks for the camera.
 */
export default function Composer({ value, onChange, attachment, onPickFile, onRemoveAttachment, onSend, busy = false, error = null, note = null, disabled = false }) {
  const { t } = useTranslation('consult');
  const formRef = useRef(null);
  const areaRef = useRef(null);
  const fileRef = useRef(null);
  useGearOffset(formRef);

  // The box grows with what is written, up to a few lines.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    const max = parseFloat(getComputedStyle(document.documentElement).fontSize) * MAX_ROWS_REM;
    area.style.height = `${Math.min(area.scrollHeight, max)}px`;
  }, [value]);

  function submit(event) {
    event.preventDefault();
    if (!busy && !disabled) onSend();
  }

  return (
    <form ref={formRef} className="composer" onSubmit={submit} noValidate>
      {error ? (
        <p className="composer__error" role="alert">
          {error}
        </p>
      ) : null}
      {note ? <p className="composer__note">{note}</p> : null}
      {attachment ? (
        <div className="composer__attachment">
          {attachment.url ? <img className="composer__thumb" src={attachment.url} alt="" /> : <ChatPhoto className="composer__thumb" name={attachment.art} label="" />}
          <span className="composer__attached">{t('composer.attached')}</span>
          <button type="button" className="icon-btn" onClick={onRemoveAttachment} aria-label={t('composer.removePhoto')}>
            <X size={24} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className="composer__row">
        <button type="button" className="icon-btn composer__attach" onClick={() => fileRef.current?.click()} disabled={disabled || busy} aria-label={t('composer.attach')}>
          <ImagePlus size={24} aria-hidden="true" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onPickFile(file);
          }}
        />
        <label className="visually-hidden" htmlFor="composer-text">
          {t('composer.label')}
        </label>
        <textarea
          id="composer-text"
          ref={areaRef}
          className="composer__input"
          rows={1}
          value={value}
          placeholder={t('composer.placeholder')}
          enterKeyHint="send"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
        />
        <button type="submit" className="composer__send" disabled={disabled || busy} aria-label={t('composer.send')} aria-busy={busy || undefined}>
          {busy ? <span className="btn__spinner" aria-hidden="true" /> : <Send size={24} aria-hidden="true" />}
        </button>
      </div>
    </form>
  );
}
