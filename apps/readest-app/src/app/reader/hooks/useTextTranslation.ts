import { useCallback, useEffect, useRef, useState } from 'react';
import { FoliateView } from '@/types/view';
import {
  createInlineTranslationCoordinator,
  type InlineTranslationCoordinator,
  type UseTranslatorOptions,
  type VisibleTranslationBlock,
  type VisibleTranslationBlockResult,
} from '@/services/translators';
import { getTranslationPreferences } from '@/helpers/translationSettings';
import { useReaderStore } from '@/store/readerStore';
import { useTranslator } from '@/hooks/useTranslator';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { walkTextNodes } from '@/utils/walk';
import { debounce } from '@/utils/debounce';
import { getLocale } from '@/utils/misc';

export function useTextTranslation(
  bookKey: string,
  view: FoliateView | HTMLElement | null,
  widthLineBreak = false,
  targetBlockClassName = 'translation-target-block',
) {
  const _ = useTranslation();
  const { getViewSettings, getProgress, setIsLoading } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);
  const translationPreferences = getTranslationPreferences(viewSettings);
  const progress = getProgress(bookKey);

  const enabled = useRef(viewSettings?.translationEnabled);
  const [provider, setProvider] = useState(translationPreferences.translationProvider);
  const [targetLang, setTargetLang] = useState(translationPreferences.translateTargetLang);
  const showTranslateSourceRef = useRef(viewSettings?.showTranslateSource);

  const { translateVisibleBlocks } = useTranslator({
    provider,
    targetLang: targetLang || getLocale(),
  } as UseTranslatorOptions);

  const translateVisibleBlocksRef = useRef(translateVisibleBlocks);
  const applyTranslatedBlocksRef = useRef<(results: VisibleTranslationBlockResult[]) => void>(
    () => {},
  );
  const handleTranslationErrorRef = useRef<
    (error: unknown, blocks: VisibleTranslationBlock[]) => void
  >(() => {});
  const observerRef = useRef<IntersectionObserver | null>(null);
  const coordinatorRef = useRef<InlineTranslationCoordinator | null>(null);
  const translatedElements = useRef<HTMLElement[]>([]);
  const allTextNodes = useRef<HTMLElement[]>([]);
  const elementIdsRef = useRef(new WeakMap<HTMLElement, string>());
  const elementsByTranslationIdRef = useRef(new Map<string, HTMLElement>());
  const nextTranslationIdRef = useRef(0);
  const pendingDOMUpdates = useRef<Array<() => void>>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleTranslationVisibility = (visible: boolean) => {
    translatedElements.current.forEach((element) => {
      const translationTargets = element.querySelectorAll('.translation-target');
      translationTargets.forEach((target) => {
        if (visible) {
          target.classList.remove('hidden');
        } else {
          target.classList.add('hidden');
        }
      });
    });
  };

  useEffect(() => {
    translateVisibleBlocksRef.current = translateVisibleBlocks;
  }, [translateVisibleBlocks]);

  useEffect(() => {
    const elementsByTranslationId = elementsByTranslationIdRef.current;

    coordinatorRef.current?.dispose();
    coordinatorRef.current = createInlineTranslationCoordinator({
      translateVisibleBlocks: (blocks) => translateVisibleBlocksRef.current(blocks),
      onResults: (results) => applyTranslatedBlocksRef.current(results),
      onError: (error, blocks) => handleTranslationErrorRef.current(error, blocks),
      onIdle: () => setIsLoading(bookKey, false),
    });

    return () => {
      coordinatorRef.current?.dispose();
      coordinatorRef.current = null;
      elementsByTranslationId.clear();
    };
  }, [bookKey, setIsLoading]);

  const hintInitialTranslating = () => {
    setIsLoading(bookKey, true);
    eventDispatcher.dispatch('hint', {
      bookKey,
      message: _('Translating...'),
    });
    hintTimerRef.current = setTimeout(() => {
      hintTimerRef.current = null;
      setIsLoading(bookKey, false);
    }, 2000);
  };

  const observeTextNodes = () => {
    if (!view || !enabled.current) return;

    const observer = createTranslationObserver();
    observerRef.current = observer;
    const nodes = walkTextNodes(view, ['pre', 'code', 'math']);
    console.log(
      'Observing text nodes for translation:',
      nodes.length,
      // nodes.map((n) => n.textContent),
    );
    allTextNodes.current = nodes;
    nodes.forEach((el) => observer.observe(el));
  };

  const updateTranslation = () => {
    coordinatorRef.current?.cancel();
    elementsByTranslationIdRef.current.clear();
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    pendingDOMUpdates.current = [];
    translatedElements.current.forEach((element) => {
      const translationTargets = element.querySelectorAll('.translation-target');
      translationTargets.forEach((target) => target.remove());
    });

    translatedElements.current = [];
    if (viewSettings?.translationEnabled && view) {
      recreateTranslationObserver();
    }
  };

  const updateSourceNodes = useCallback((element: HTMLElement) => {
    const hasDirectText = Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '',
    );
    if (hasDirectText) {
      element.classList.add('translation-source');

      const textNodes = Array.from(element.childNodes).filter(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '',
      );

      if (!element.hasAttribute('original-text-stored')) {
        element.setAttribute(
          'original-text-nodes',
          JSON.stringify(textNodes.map((node) => node.textContent)),
        );
        element.setAttribute('original-text-stored', 'true');
      }
    }
    const isSource = element.classList.contains('translation-source');
    if (isSource) {
      const textNodes = Array.from(element.childNodes).filter(
        (node) => node.nodeType === Node.TEXT_NODE,
      ) as Text[];

      if (showTranslateSourceRef.current) {
        const originalTexts = JSON.parse(element.getAttribute('original-text-nodes') || '[]');
        textNodes.forEach((textNode, index) => {
          if (originalTexts[index] !== undefined) {
            textNode.textContent = originalTexts[index];
          }
        });
      } else {
        textNodes.forEach((textNode) => {
          textNode.textContent = '';
        });
      }
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const node = child as HTMLElement;
      if (!node.classList.contains('translation-target')) {
        updateSourceNodes(node);
      }
    }
  }, []);

  const createTranslationObserver = () => {
    const visibleElements = new Set<HTMLElement>();
    return new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleElements.add(entry.target as HTMLElement);
          } else {
            visibleElements.delete(entry.target as HTMLElement);
          }
        }

        if (visibleElements.size === 0) return;

        const nodes = allTextNodes.current;
        if (nodes.length === 0) return;

        let firstIdx = nodes.length;
        let lastIdx = -1;
        for (const el of visibleElements) {
          const idx = nodes.indexOf(el);
          if (idx !== -1) {
            if (idx < firstIdx) firstIdx = idx;
            if (idx > lastIdx) lastIdx = idx;
          }
        }

        if (lastIdx === -1) return;

        const startIdx = Math.max(0, firstIdx - 1);
        const endIdx = Math.min(nodes.length - 1, lastIdx + 2);

        for (let i = startIdx; i <= endIdx; i++) {
          const node = nodes[i];
          if (node) {
            scheduleTranslation(node);
          }
        }
      },
      { threshold: 0 },
    );
  };

  const getElementTranslationId = (element: HTMLElement) => {
    let id = elementIdsRef.current.get(element);
    if (!id) {
      id = `${nextTranslationIdRef.current++}`;
      elementIdsRef.current.set(element, id);
    }
    return id;
  };

  const scheduleTranslation = (el: HTMLElement) => {
    if (!enabled.current) return;
    if (el.classList.contains('translation-target')) return;
    if (el.querySelector('.translation-target')) return;
    const text = el.textContent?.replaceAll('\n', '').trim();
    if (!text) return;

    const id = getElementTranslationId(el);
    elementsByTranslationIdRef.current.set(id, el);
    coordinatorRef.current?.enqueue([{ id, text }]);
  };

  const batchDOMUpdate = (update: () => void) => {
    pendingDOMUpdates.current.push(update);
    if (!batchTimerRef.current) {
      batchTimerRef.current = setTimeout(() => {
        batchTimerRef.current = null;
        const updates = pendingDOMUpdates.current.splice(0);
        updates.forEach((fn) => fn());
      }, 50);
    }
  };

  const recreateTranslationObserver = () => {
    const observer = createTranslationObserver();
    observerRef.current?.disconnect();
    observerRef.current = observer;
    allTextNodes.current.forEach((el) => observer.observe(el));
  };

  useEffect(() => {
    applyTranslatedBlocksRef.current = (translatedBlocks: VisibleTranslationBlockResult[]) => {
      translatedBlocks.forEach((block) => {
        const element = elementsByTranslationIdRef.current.get(block.id);
        elementsByTranslationIdRef.current.delete(block.id);

        if (!element) return;

        const currentText = element.textContent?.replaceAll('\n', '').trim();
        if (
          !currentText ||
          currentText !== block.originalText ||
          !block.translatedText ||
          block.originalText === block.translatedText ||
          element.querySelector('.translation-target')
        ) {
          return;
        }

        const wrapper = document.createElement('font');
        wrapper.className = `translation-target ${!enabled.current ? 'hidden' : ''}`;
        wrapper.setAttribute('translation-element-mark', '1');
        wrapper.setAttribute('lang', targetLang || getLocale());
        if (widthLineBreak) {
          wrapper.appendChild(document.createElement('br'));
        }

        const blockWrapper = document.createElement('font');
        blockWrapper.className = `translation-target ${targetBlockClassName}`;

        const inner = document.createElement('font');
        inner.className = 'translation-target target-inner target-inner-theme-none';
        inner.textContent = block.translatedText;

        blockWrapper.appendChild(inner);
        wrapper.appendChild(blockWrapper);

        batchDOMUpdate(() => {
          if (
            !enabled.current ||
            !element.isConnected ||
            element.querySelector('.translation-target')
          ) {
            return;
          }

          const liveText = element.textContent?.replaceAll('\n', '').trim();
          if (!liveText || liveText !== block.originalText) return;

          updateSourceNodes(element);
          element.appendChild(wrapper);
          translatedElements.current.push(element);
        });
      });
    };

    handleTranslationErrorRef.current = (error, blocks) => {
      blocks.forEach((block) => {
        elementsByTranslationIdRef.current.delete(block.id);
      });
      console.warn('Translation failed:', error);
    };
  }, [targetLang, targetBlockClassName, updateSourceNodes, widthLineBreak]);

  const findNodeIndicesInRange = (range: Range, nodes: HTMLElement[]) => {
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    let startIndex = -1;
    let endIndex = -1;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (node === startContainer || node.contains(startContainer)) {
        if (startIndex === -1) startIndex = i;
      }
      if (node === endContainer || node.contains(endContainer)) {
        endIndex = i;
      }
    }
    if (startIndex !== -1 && endIndex === -1) {
      endIndex = startIndex;
    }

    return { startIndex, endIndex };
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const translateInRange = useCallback(
    debounce((range: Range) => {
      const nodes = allTextNodes.current;
      if (nodes.length === 0) {
        console.warn('No text nodes available for translation.');
        return;
      }
      const { startIndex, endIndex } = findNodeIndicesInRange(range, nodes);
      if (startIndex === -1) {
        console.log('Range not found in text nodes');
        return;
      }
      const beforeContext = 2;
      const afterContext = 5;
      const beforeStart = Math.max(0, startIndex - beforeContext);
      const afterEnd = Math.min(nodes.length - 1, endIndex + afterContext);
      for (let i = beforeStart; i <= afterEnd; i++) {
        const node = nodes[i];
        if (node) {
          scheduleTranslation(node);
        }
      }
    }, 500),
    [scheduleTranslation],
  );

  useEffect(() => {
    if (enabled.current && progress) {
      const { range } = progress;
      translateInRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  useEffect(() => {
    if (!viewSettings) return;

    const enabledChanged = enabled.current !== viewSettings.translationEnabled;
    const providerChanged = provider !== translationPreferences.translationProvider;
    const targetLangChanged = targetLang !== translationPreferences.translateTargetLang;
    const showTranslateSourceChanged =
      showTranslateSourceRef.current !== viewSettings.showTranslateSource;

    if (enabledChanged) {
      enabled.current = viewSettings.translationEnabled;
    }

    if (providerChanged) {
      setProvider(translationPreferences.translationProvider);
    }

    if (targetLangChanged) {
      setTargetLang(translationPreferences.translateTargetLang);
    }

    if (showTranslateSourceChanged) {
      showTranslateSourceRef.current = viewSettings.showTranslateSource;
    }

    if (enabledChanged) {
      toggleTranslationVisibility(viewSettings.translationEnabled);
      if (enabled.current) {
        observeTextNodes();
      }
    } else if (providerChanged || targetLangChanged || showTranslateSourceChanged) {
      updateTranslation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, viewSettings, provider, targetLang]);

  useEffect(() => {
    if (!view || !enabled.current) return;

    const elementsByTranslationId = elementsByTranslationIdRef.current;

    if ('renderer' in view) {
      view.addEventListener('load', observeTextNodes);
      view.addEventListener('load', hintInitialTranslating);
    } else {
      observeTextNodes();
    }
    return () => {
      if ('renderer' in view) {
        view.removeEventListener('load', observeTextNodes);
        view.removeEventListener('load', hintInitialTranslating);
      }
      observerRef.current?.disconnect();
      translatedElements.current = [];
      coordinatorRef.current?.cancel();
      elementsByTranslationId.clear();
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
      pendingDOMUpdates.current = [];
      setIsLoading(bookKey, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
}
