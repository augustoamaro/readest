import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { saveViewSettings } from '@/helpers/settings';
import { saveTranslationPreference } from '@/helpers/translationSettings';
import { translationFacade, type TranslationProviderAvailability } from '@/services/translators';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { TRANSLATED_LANGS, TRANSLATOR_LANGS } from '@/services/constants';
import { ConvertChineseVariant } from '@/types/book';
import { SettingsPanelPanelProp } from './SettingsDialog';
import { getDirFromLanguage } from '@/utils/rtl';
import { isCJKEnv } from '@/utils/misc';
import Select from '@/components/Select';

const LOCAL_CTRANSLATE2_PROVIDER = 'local-ctranslate2';

const LangPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { token } = useAuth();
  const { envConfig } = useEnv();
  const { settings, applyUILanguage } = useSettingsStore();
  const { getView, getViewSettings, setViewSettings, recreateViewer } = useReaderStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [uiLanguage, setUILanguage] = useState(viewSettings.uiLanguage);
  const [translationEnabled, setTranslationEnabled] = useState(viewSettings.translationEnabled);
  const [translationProvider, setTranslationProvider] = useState(viewSettings.translationProvider);
  const [translateTargetLang, setTranslateTargetLang] = useState(viewSettings.translateTargetLang);
  const [showTranslateSource, setShowTranslateSource] = useState(viewSettings.showTranslateSource);
  const [dimTranslateSourceText, setDimTranslateSourceText] = useState(
    viewSettings.dimTranslateSourceText ?? false,
  );
  const [ttsReadAloudText, setTtsReadAloudText] = useState(viewSettings.ttsReadAloudText);
  const [replaceQuotationMarks, setReplaceQuotationMarks] = useState(
    viewSettings.replaceQuotationMarks,
  );
  const [convertChineseVariant, setConvertChineseVariant] = useState(
    viewSettings.convertChineseVariant,
  );
  const [localProviderAvailability, setLocalProviderAvailability] =
    useState<TranslationProviderAvailability>(() =>
      translationFacade.getProviderAvailability(LOCAL_CTRANSLATE2_PROVIDER),
    );

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      uiLanguage: setUILanguage,
      translationEnabled: setTranslationEnabled,
      translationProvider: setTranslationProvider,
      translateTargetLang: setTranslateTargetLang,
      showTranslateSource: setShowTranslateSource,
      dimTranslateSourceText: setDimTranslateSourceText,
      ttsReadAloudText: setTtsReadAloudText,
      replaceQuotationMarks: setReplaceQuotationMarks,
    });
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let mounted = true;
    void translationFacade
      .refreshProviderAvailability(LOCAL_CTRANSLATE2_PROVIDER)
      .then((availability) => {
        if (mounted) {
          setLocalProviderAvailability(availability);
        }
      });

    return () => {
      mounted = false;
    };
  }, [translationProvider]);

  const getCurrentUILangOption = () => {
    const uiLanguage = viewSettings.uiLanguage;
    return {
      value: uiLanguage,
      label:
        uiLanguage === ''
          ? _('Auto')
          : TRANSLATED_LANGS[uiLanguage as keyof typeof TRANSLATED_LANGS],
    };
  };

  const getLangOptions = (langs: Record<string, string>) => {
    const options = Object.entries(langs).map(([value, label]) => ({ value, label }));
    options.sort((a, b) => a.label.localeCompare(b.label));
    options.unshift({ value: '', label: _('System Language') });
    return options;
  };

  const handleSelectUILang = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setUILanguage(option);
  };

  const getTranslationProviderOptions = () => {
    const translators = translationFacade.listProviders();
    const availableProviders = translators.flatMap((t) => {
      const isLocalProvider = t.name === LOCAL_CTRANSLATE2_PROVIDER;
      if (
        isLocalProvider &&
        localProviderAvailability.status === 'unavailable' &&
        translationProvider !== t.name
      ) {
        return [];
      }

      let label = t.label;
      if (t.authRequired && !token) {
        label = `${label} (${_('Login Required')})`;
      } else if (t.quotaExceeded) {
        label = `${label} (${_('Quota Exceeded')})`;
      } else if (isLocalProvider) {
        if (localProviderAvailability.status === 'available') {
          label = `${label} (${_('Local Ready')})`;
        } else if (localProviderAvailability.status === 'unavailable') {
          label = `${label} (${_('Offline')})`;
        } else {
          label = `${label} (${_('Checking')})`;
        }
      }
      return [{ value: t.name, label }];
    });
    return availableProviders;
  };

  const getCurrentTranslationProviderOption = () => {
    const value = translationProvider;
    const allProviders = getTranslationProviderOptions();
    const currentProvider = allProviders.find((provider) => provider.value === value)
      ? value
      : allProviders[0]?.value;
    return allProviders.find((p) => p.value === currentProvider) || allProviders[0]!;
  };

  const getLocalProviderHint = () => {
    if (translationProvider !== LOCAL_CTRANSLATE2_PROVIDER) return null;

    if (localProviderAvailability.status === 'available') {
      return _('Local CTranslate2 service ready{{device}}.', {
        device: localProviderAvailability.details?.device
          ? ` (${localProviderAvailability.details.device})`
          : '',
      });
    }

    if (localProviderAvailability.status === 'unavailable') {
      return _(
        'Local CTranslate2 service is offline. Start the local translation server to use this provider.',
      );
    }

    return _('Checking local CTranslate2 service...');
  };

  const handleSelectTranslationProvider = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setTranslationProvider(option);
    saveTranslationPreference(envConfig, bookKey, 'translationProvider', option);
    viewSettings.translationProvider = option;
    setViewSettings(bookKey, { ...viewSettings });
  };

  const getCurrentTargetLangOption = () => {
    const value = translateTargetLang;
    const availableOptions = getLangOptions(TRANSLATOR_LANGS);
    return availableOptions.find((o) => o.value === value) || availableOptions[0]!;
  };

  const handleSelectTargetLang = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setTranslateTargetLang(option);
    saveTranslationPreference(envConfig, bookKey, 'translateTargetLang', option);
    viewSettings.translateTargetLang = option;
    setViewSettings(bookKey, { ...viewSettings });
  };

  const handleSelectTTSText = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setTtsReadAloudText(option);
    saveViewSettings(envConfig, bookKey, 'ttsReadAloudText', option, false, false);
  };

  const getTTSTextOptions = () => {
    return [
      { value: 'both', label: _('Source and Translated') },
      { value: 'translated', label: _('Translated Only') },
      { value: 'source', label: _('Source Only') },
    ];
  };

  useEffect(() => {
    if (uiLanguage === viewSettings.uiLanguage) return;
    const sameDir = getDirFromLanguage(uiLanguage) === getDirFromLanguage(viewSettings.uiLanguage);
    applyUILanguage(uiLanguage);
    saveViewSettings(envConfig, bookKey, 'uiLanguage', uiLanguage, false, false).then(() => {
      if (!sameDir) window.location.reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiLanguage]);

  useEffect(() => {
    if (translationEnabled === viewSettings.translationEnabled) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'translationEnabled',
      translationEnabled,
      true,
      false,
    ).then(() => {
      if (!showTranslateSource && translationEnabled) {
        recreateViewer(envConfig, bookKey);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationEnabled]);

  useEffect(() => {
    if (showTranslateSource === viewSettings.showTranslateSource) return;
    // Inline translation updates source/target DOM in place; recreating the viewer here can
    // interrupt in-flight EPUB asset loads without changing the rendered chapter.
    saveViewSettings(envConfig, bookKey, 'showTranslateSource', showTranslateSource, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTranslateSource]);

  useEffect(() => {
    if (dimTranslateSourceText === (viewSettings.dimTranslateSourceText ?? false)) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'dimTranslateSourceText',
      dimTranslateSourceText,
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimTranslateSourceText]);

  useEffect(() => {
    if (ttsReadAloudText === viewSettings.ttsReadAloudText) return;
    saveViewSettings(envConfig, bookKey, 'ttsReadAloudText', ttsReadAloudText, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsReadAloudText]);

  useEffect(() => {
    if (replaceQuotationMarks === viewSettings.replaceQuotationMarks) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'replaceQuotationMarks',
      replaceQuotationMarks,
      false,
      false,
    ).then(() => {
      recreateViewer(envConfig, bookKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceQuotationMarks]);

  const getConvertModeOptions: () => { value: ConvertChineseVariant; label: string }[] = () => {
    return [
      { value: 'none', label: _('No Conversion') },
      { value: 's2t', label: _('Simplified to Traditional') },
      { value: 't2s', label: _('Traditional to Simplified') },
      { value: 's2tw', label: _('Simplified to Traditional (Taiwan)') },
      { value: 's2hk', label: _('Simplified to Traditional (Hong Kong)') },
      { value: 's2twp', label: _('Simplified to Traditional (Taiwan), with phrases') },
      { value: 'tw2s', label: _('Traditional (Taiwan) to Simplified') },
      { value: 'hk2s', label: _('Traditional (Hong Kong) to Simplified') },
      { value: 'tw2sp', label: _('Traditional (Taiwan) to Simplified, with phrases') },
    ];
  };

  const getConvertModeOption = () => {
    const value = convertChineseVariant;
    const availableOptions = getConvertModeOptions();
    return availableOptions.find((o) => o.value === value) || availableOptions[0]!;
  };

  const handleSelectConvertMode = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value as ConvertChineseVariant;
    setConvertChineseVariant(option);
  };

  useEffect(() => {
    if (convertChineseVariant === viewSettings.convertChineseVariant) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'convertChineseVariant',
      convertChineseVariant,
      false,
      false,
    ).then(() => {
      recreateViewer(envConfig, bookKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertChineseVariant]);

  return (
    <div className={clsx('my-4 w-full space-y-6')}>
      <div className='w-full' data-setting-id='settings.language.interfaceLanguage'>
        <h2 className='mb-2 font-medium'>{_('Language')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span className=''>{_('Interface Language')}</span>
              <Select
                value={getCurrentUILangOption().value}
                onChange={handleSelectUILang}
                options={getLangOptions(TRANSLATED_LANGS)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className='w-full' data-setting-id='settings.language.translationEnabled'>
        <h2 className='mb-2 font-medium'>{_('Translation')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200'>
            <div className='config-item'>
              <span className=''>{_('Enable Translation')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={translationEnabled}
                onChange={() => setTranslationEnabled(!translationEnabled)}
                disabled={!bookKey}
              />
            </div>

            <div className='config-item'>
              <span className=''>{_('Show Source Text')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={showTranslateSource}
                onChange={() => setShowTranslateSource(!showTranslateSource)}
              />
            </div>

            {showTranslateSource && (
              <div className='config-item' data-setting-id='settings.language.dimSourceText'>
                <span className=''>{_('Dim Source Text')}</span>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={dimTranslateSourceText}
                  onChange={() => setDimTranslateSourceText(!dimTranslateSourceText)}
                />
              </div>
            )}

            <div className='config-item' data-setting-id='settings.language.ttsTextTranslation'>
              <span className=''>{_('TTS Text')}</span>
              <Select
                value={ttsReadAloudText}
                onChange={handleSelectTTSText}
                options={getTTSTextOptions()}
              />
            </div>

            <div className='config-item' data-setting-id='settings.language.translationProvider'>
              <span className=''>{_('Translation Service')}</span>
              <Select
                value={getCurrentTranslationProviderOption().value}
                onChange={handleSelectTranslationProvider}
                options={getTranslationProviderOptions()}
              />
            </div>
            {translationProvider === LOCAL_CTRANSLATE2_PROVIDER && (
              <div className='px-4 pb-3 pt-0 text-right text-xs opacity-70'>
                {getLocalProviderHint()}
              </div>
            )}

            <div className='config-item' data-setting-id='settings.language.targetLanguage'>
              <span className=''>{_('Translate To')}</span>
              <Select
                value={getCurrentTargetLangOption().value}
                onChange={handleSelectTargetLang}
                options={getLangOptions(TRANSLATOR_LANGS)}
              />
            </div>
          </div>
        </div>
      </div>

      {(isCJKEnv() || view?.language.isCJK) && (
        <div className='w-full' data-setting-id='settings.language.quotationMarks'>
          <h2 className='mb-2 font-medium'>{_('Punctuation')}</h2>
          <div className='card border-base-200 bg-base-100 border shadow'>
            <div className='divide-base-200'>
              <div className='config-item !h-16'>
                <div className='flex flex-col gap-1'>
                  <span className=''>{_('Replace Quotation Marks')}</span>
                  <span className='text-xs'>{_('Enabled only in vertical layout.')}</span>
                </div>
                <input
                  type='checkbox'
                  className='toggle'
                  checked={replaceQuotationMarks}
                  onChange={() => setReplaceQuotationMarks(!replaceQuotationMarks)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {(isCJKEnv() || view?.language.isCJK) && (
        <div className='w-full' data-setting-id='settings.language.chineseConversion'>
          <h2 className='mb-2 font-medium'>{_('Convert Simplified and Traditional Chinese')}</h2>
          <div className='card border-base-200 bg-base-100 border shadow'>
            <div className='divide-base-200'>
              <div className='config-item'>
                <span className=''>{_('Convert Mode')}</span>
                <Select
                  value={getConvertModeOption().value}
                  onChange={handleSelectConvertMode}
                  options={getConvertModeOptions()}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LangPanel;
