/**
 * Pi project-local configuration directory name.
 *
 * Kept behind a named export so config path construction depends on the
 * CONFIG_DIR_NAME contract instead of repeating the literal at call sites.
 */
export const CONFIG_DIR_NAME = '.pi';
