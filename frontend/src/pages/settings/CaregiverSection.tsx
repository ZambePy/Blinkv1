import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BellRing, BookOpen, LayoutDashboard, Plus, Siren, Trash2, Users } from 'lucide-react';
import { useReminders } from '../../context/ReminderContext';
import { useToast } from '../../context/ToastContext';
import { Card, Field, Note, Section } from '../caregiver/CaregiverControls';

/** Lembretes do paciente, atalhos do cuidador e como a emergência funciona. */
export const CaregiverSection: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { reminders, addReminder, deleteReminder } = useReminders();
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !time.trim()) {
      toast.error(t('settings.caregiver.reminders.missing'));
      return;
    }
    addReminder({ title: title.trim(), time });
    setTitle('');
    setTime('');
    toast.success(t('settings.caregiver.reminders.added'));
  };

  const sorted = [...reminders].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <Section id="sec-caregiver" title={t('settings.caregiver.title')} icon={<Users size={26} aria-hidden="true" />}>
      <div className="cg-grid">
        <Card
          id="reminders"
          title={t('settings.caregiver.reminders.title')}
          description={t('settings.caregiver.reminders.description')}
          icon={<BellRing size={24} />}
          className="cg-span-all"
        >
          <form
            onSubmit={submit}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem', alignItems: 'flex-end' }}
          >
            <div style={{ flex: '2 1 240px' }}>
              <Field label={t('settings.caregiver.reminders.what')} htmlFor="reminder-title">
                <input
                  id="reminder-title"
                  type="text"
                  className="cg-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('settings.caregiver.reminders.placeholder')}
                  maxLength={80}
                  data-no-dwell="true"
                />
              </Field>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <Field label={t('settings.caregiver.reminders.when')} htmlFor="reminder-time">
                <input
                  id="reminder-time"
                  type="time"
                  className="cg-input"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  data-no-dwell="true"
                />
              </Field>
            </div>
            <button type="submit" className="btn btn--primary" data-no-dwell="true">
              <Plus size={18} aria-hidden="true" /> {t('settings.caregiver.reminders.add')}
            </button>
          </form>

          <h4 style={{ margin: '1.25rem 0 0.6rem', fontSize: 'var(--fs-16)', color: 'var(--text-2)' }}>
            {t('settings.caregiver.reminders.scheduled', { count: reminders.length })}
          </h4>
          {sorted.length === 0 ? (
            <p className="cg-empty">{t('settings.caregiver.reminders.empty')}</p>
          ) : (
            <ul className="cg-list">
              {sorted.map((r) => (
                <li key={r.id} className="cg-list__item">
                  <div className="cg-list__lead">
                    <span className="cg-list__time">{r.time}</span>
                    <span className="cg-list__title">{r.title}</span>
                  </div>
                  <button
                    type="button"
                    className="cg-icon-btn cg-icon-btn--danger"
                    aria-label={t('settings.caregiver.reminders.remove', { title: r.title })}
                    onClick={() => {
                      deleteReminder(r.id);
                      toast.success(t('settings.caregiver.reminders.removed'));
                    }}
                    data-no-dwell="true"
                  >
                    <Trash2 size={20} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          id="caregiver-links"
          title={t('settings.caregiver.links.title')}
          description={t('settings.caregiver.links.description')}
          icon={<LayoutDashboard size={24} />}
        >
          <div className="cg-card__actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn--primary" onClick={() => navigate('/caregiver')} data-no-dwell="true">
              <LayoutDashboard size={18} aria-hidden="true" /> {t('settings.dashboardLink.button')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => navigate('/caregiver/guide?from=/settings')}
              data-no-dwell="true"
            >
              <BookOpen size={18} aria-hidden="true" /> {t('settings.caregiver.links.guide')}
            </button>
          </div>
        </Card>

        <Card
          id="emergency-info"
          title={t('settings.caregiver.emergency.title')}
          icon={<Siren size={24} />}
          iconTone="danger"
        >
          <Note tone="danger">{t('settings.caregiver.emergency.body')}</Note>
        </Card>
      </div>
    </Section>
  );
};
