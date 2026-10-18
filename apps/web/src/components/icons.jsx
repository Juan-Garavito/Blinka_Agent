/** Iconos lineales propios (1.5 px), sin librería externa. Decorativos: aria-hidden. */
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" };
const make = (paths) =>
  function Icon({ size = 18, ...rest }) {
    return (
      <svg {...base} width={size} height={size} {...rest}>
        {paths}
      </svg>
    );
  };

export const IconCheck = make(<path d="M5 12.5l4.2 4.2L19 7" />);
export const IconCheckCircle = make(<><circle cx="12" cy="12" r="9" /><path d="M8 12.3l2.7 2.7L16.2 9.5" /></>);
export const IconBlock = make(<><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>);
export const IconHourglass = make(<path d="M7 3h10M7 21h10M8 3v3.5a4 4 0 0 0 1.6 3.2L12 12l2.4 2.3A4 4 0 0 1 16 17.5V21M16 3v3.5a4 4 0 0 1-1.6 3.2M8 21v-3.5a4 4 0 0 1 1.6-3.2" />);
export const IconEdit = make(<><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 6.5l3 3" /></>);
export const IconX = make(<><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>);
export const IconAlert = make(<><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.1" /></>);
export const IconCpu = make(<><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3" /></>);
export const IconClock = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IconDoc = make(<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h4" /></>);
export const IconUpload = make(<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></>);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconArrowRight = make(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconArrowLeft = make(<path d="M19 12H5M11 6l-6 6 6 6" />);
export const IconChevronDown = make(<path d="M6 9l6 6 6-6" />);
export const IconMenu = make(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconClose = make(<path d="M6 6l12 12M18 6L6 18" />);
export const IconSearch = make(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>);
export const IconLink = make(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);
export const IconShield = make(<><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" /><path d="M9 12l2.2 2.2L15.5 10" /></>);
export const IconFlask = make(<><path d="M9.5 3h5M10 3v6l-5.2 9.1A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-2.9L14 9V3" /><path d="M7.6 15h8.8" /></>);
export const IconRefresh = make(<><path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4" /></>);
export const IconExternal = make(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v6H4V6h6" /></>);
export const IconUser = make(<><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1.3-3.6 4.2-5.5 7.5-5.5s6.2 1.9 7.5 5.5" /></>);
export const IconLayers = make(<><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>);
export const IconDot = make(<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />);
