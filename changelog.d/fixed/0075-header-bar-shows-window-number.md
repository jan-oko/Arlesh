- **Window titles are just the name and number, and the title bar inside a window shows them.** A
  window is titled `Arlesh` when it is the only one open, and `Arlesh [1]`, `Arlesh [2]` and so on
  while there are several. The tray menu lists windows by those same titles. The active tab is no
  longer part of the title, so the title no longer changes as you switch tabs.

  On Wayland, the title bar Arlesh draws inside each window, the one with the minimise, maximise
  and close buttons, used to read plain `Arlesh` even while the window manager's bars showed the
  window's number. It now matches the title everywhere else, and it updates when a second window
  opens or the last but one closes.
