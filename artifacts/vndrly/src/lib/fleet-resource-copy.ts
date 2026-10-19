import {useTranslation} from "react-i18next";
import {fleetResourceCopy} from "@workspace/api-zod";
export function useFleetResourceCopy(){const {i18n}=useTranslation();return (text:string)=>fleetResourceCopy(text,i18n?.resolvedLanguage??i18n?.language??"en");}
