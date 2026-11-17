import React from "react";
import {ScrollView,Text} from "react-native";
import {useLocalSearchParams} from "expo-router";
import {z} from "zod/v4";
import {useTranslation} from "react-i18next";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import BundleDetail from "@/components/work-hub/library/BundleDetail";
import {certificationProgramById} from '@workspace/api-zod/certification-program-links';
import CertificationProgramReference from '@/components/work-hub/library/CertificationProgramReference';
export default function Page(){const {t}=useTranslation(),raw=useLocalSearchParams<{itemId:string}>().itemId,id=z.uuid().safeParse(raw),program=certificationProgramById(String(raw));return <ScreenSafeArea><ScrollView contentContainerStyle={{padding:16,gap:16}}><WorkHubPageTitle title={t("workHubLibrary.bundles")}/>{program?<CertificationProgramReference program={program}/>:id.success||raw==='new'?<BundleDetail key={String(raw)} itemId={String(raw)}/>:<Text>{t("workHubLibrary.invalidLink")}</Text>}</ScrollView></ScreenSafeArea>;}
