import React, { useState, useRef, useEffect } from 'react';
import { useDiagramStore } from '../store/diagramStore';

const IconPlay = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="4,2 13,8 4,14" fill="currentColor" stroke="none" />
  </svg>
)
const IconPause = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="2" x2="5" y2="14" strokeWidth={2.2} />
    <line x1="11" y1="2" x2="11" y2="14" strokeWidth={2.2} />
  </svg>
)

export function TimeTravelBar(): React.ReactElement | null {
  const appMode = useDiagramStore(s => s.appMode);
  const presentationActive = useDiagramStore(s => s.presentationActive);
  const slides = useDiagramStore(s => s.presentationSlides);
  const idx = useDiagramStore(s => s.presentationSlideIndex);
  const goToSlide = useDiagramStore(s => s.goToSlide);
  const startPresentation = useDiagramStore(s => s.startPresentation);

  const [playing, setPlaying] = useState(false);
  const playRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Scroll active slide into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [idx]);

  // Auto-play through slides
  useEffect(() => {
    if (playing && slides.length > 1) {
      playRef.current = setInterval(() => {
        const current = useDiagramStore.getState().presentationSlideIndex;
        if (current < slides.length - 1) {
          goToSlide(current + 1);
        } else {
          setPlaying(false);
        }
      }, 1500);
    } else if (playRef.current) {
      clearInterval(playRef.current);
      playRef.current = null;
    }
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [playing, slides.length, goToSlide]);

  useEffect(() => { setPlaying(false); }, [appMode]);

  if (appMode === 'designer') return null;
  if (presentationActive) return null;
  if (slides.length === 0) return null;

  return (
    <div className="slidestrip-bar">
      <button
        className={`slidestrip-play-btn${playing ? ' active' : ''}`}
        onClick={() => playing ? setPlaying(false) : startPresentation()}
        title="Present (F5)"
      >
        {playing ? <IconPause /> : <IconPlay />}
      </button>
      <div className="slidestrip-track">
        {slides.map((slide, i) => (
          <button
            key={slide.id}
            ref={i === idx ? activeRef : null}
            className={`slidestrip-card${i === idx ? ' active' : ''}`}
            onClick={() => { setPlaying(false); goToSlide(i); }}
            title={slide.name}
          >
            <span className="slidestrip-num">{i + 1}</span>
            <span className="slidestrip-name">{slide.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
