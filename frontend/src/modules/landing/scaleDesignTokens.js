export const tailwindThemeExtension = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: '#090A07',
        paper: '#F4F0E8',
        bone: '#E9E1D1',
        graphite: '#171815',
        moss: '#12351F',
        fern: '#9DFF65',
        aqua: '#5DF5DC',
        copper: '#D49A66',
        plum: '#8D71FF',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular'],
      },
      borderRadius: {
        orbit: '999px',
        editorial: '1.75rem',
      },
      boxShadow: {
        orbit: '0 24px 80px rgba(0, 0, 0, 0.28)',
        halo: '0 0 0 1px rgba(244, 240, 232, 0.14), 0 0 70px rgba(93, 245, 220, 0.12)',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.19, 1, 0.22, 1)',
      },
    },
  },
};

// Framer Motion version of the shared-layout intent. The preview component uses
// pure React + CSS so it can run without adding a new dependency to this repo.
export const framerLayoutSpec = {
  sharedLayout: {
    smallCard: {
      layoutId: 'module-${id}',
      initial: { borderRadius: 999, scale: 1 },
      whileHover: { scale: 1.08, y: -6 },
      transition: { type: 'spring', stiffness: 220, damping: 24, mass: 0.8 },
    },
    detail: {
      layoutId: 'module-${id}',
      initial: { borderRadius: 999 },
      animate: { borderRadius: 0, scale: 1 },
      exit: { borderRadius: 999, scale: 0.16 },
      transition: { type: 'spring', stiffness: 130, damping: 22, mass: 1.1 },
    },
    detailContent: {
      initial: { opacity: 0, y: 24 },
      animate: { opacity: 1, y: 0, transition: { delay: 0.18, duration: 0.42 } },
      exit: { opacity: 0, y: 12, transition: { duration: 0.18 } },
    },
  },
};
