import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtNum, isoDate } from '../domain/util';
import { t } from '../i18n';
import { haptic } from '../platform/haptics';
import { useStore } from '../store';
import { toast } from '../ui/snackbar';
import { Sheet } from './ui';

const parseNum = (s: string) => {
  const v = Number(s.trim().replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(v) && v > 0 ? v : undefined;
};
const fmtDay = (d: string) => (d === isoDate() ? t('log.today') : new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));

/** Quick weigh-in from anywhere: scale weight (and optional body fat) for a day, today by default. */
export function WeighInSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const unit = useStore((s) => s.settings.weightUnit);
  const body = useStore((s) => s.body);
  const saveBody = useStore((s) => s.saveBody);
  const nav = useNavigate();
  const [date, setDate] = useState(isoDate());
  const [weight, setWeight] = useState('');
  const [fat, setFat] = useState('');

  // Opening shows today and whatever was already logged for it.
  useEffect(() => {
    if (!open) return;
    const today = isoDate();
    const cur = useStore.getState().body.find((b) => b.date === today);
    setDate(today);
    setWeight(cur?.weight !== undefined ? fmtNum(cur.weight, 2) : '');
    setFat(cur?.bodyFat !== undefined ? fmtNum(cur.bodyFat, 1) : '');
  }, [open]);

  const last = [...body].reverse().find((b) => b.weight !== undefined && b.date !== date);
  const w = parseNum(weight);
  const bf = parseNum(fat);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (w === undefined) {
      haptic('warning');
      toast(t('body.invalid'));
      return;
    }
    const v = Math.round(w * 100) / 100;
    saveBody({ date, weight: v, ...(bf !== undefined ? { bodyFat: Math.round(bf * 10) / 10 } : {}) });
    haptic('success');
    toast(t('weigh.saved', { value: fmtNum(v, 2), unit, day: fmtDay(date) }));
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('weigh.title')}>
      <form onSubmit={save}>
        <div className="grid2">
          <div>
            <label className="lbl" htmlFor="weigh-value">
              {t('weigh.weight', { unit })}
            </label>
            <input
              id="weigh-value"
              className="field num fw-weigh-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              placeholder={last?.weight !== undefined ? fmtNum(last.weight, 1) : unit}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </div>
          <div>
            <label className="lbl" htmlFor="weigh-date">
              {t('body.date')}
            </label>
            <input id="weigh-date" className="field num" type="date" value={date} max={isoDate()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
        </div>
        <label className="lbl" htmlFor="weigh-fat">
          {t('weigh.bodyFat')}
        </label>
        <input id="weigh-fat" className="field num" type="text" inputMode="decimal" autoComplete="off" value={fat} onChange={(e) => setFat(e.target.value)} />
        <p className="muted tiny">{last?.weight !== undefined ? t('weigh.last', { value: fmtNum(last.weight, 2), unit, day: fmtDay(last.date) }) : t('weigh.hint')}</p>
        <button className="btn primary block" type="submit" disabled={w === undefined}>
          {t('weigh.save')}
        </button>
        <button
          className="btn ghost block"
          type="button"
          style={{ marginTop: 6 }}
          onClick={() => {
            onClose();
            nav('/more/body');
          }}
        >
          {t('weigh.all')}
        </button>
      </form>
    </Sheet>
  );
}
