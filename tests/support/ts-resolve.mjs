// Pozwala Node uruchamiać pliki .ts z lib/ bez bundlera: importy względne
// bez rozszerzenia ("./guard") są uzupełniane o ".ts". Next robi to sam.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        // brak pliku .ts: zwykłe rozwiązywanie poniżej
      }
    }
    return next(specifier, context);
  },
});
