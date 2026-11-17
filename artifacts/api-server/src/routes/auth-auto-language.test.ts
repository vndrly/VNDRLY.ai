import { expect, it } from "vitest";
import { accountLanguagePreference } from "./auth";
it("defaults an invited account to English and requests a first-login choice",()=>{
  expect(accountLanguagePreference(null)).toEqual({preferredLanguage:"en",needsLanguageChoice:true});
  expect(accountLanguagePreference(undefined)).toEqual({preferredLanguage:"en",needsLanguageChoice:true});
});
it.each(["en","es"])("keeps an explicit %s choice and does not prompt again",language=>{
  expect(accountLanguagePreference(language)).toEqual({preferredLanguage:language,needsLanguageChoice:false});
});
