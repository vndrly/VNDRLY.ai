import React from "react";
import {ScrollView,Text} from "react-native";
import {useLocalSearchParams} from "expo-router";
import {z} from "zod/v4";
import {useTranslation} from "react-i18next";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import BundleDetail from "@/components/work-hub/library/BundleDetail";
export default function Page(){const {t}=useTranslation(),raw=useLocalSearchParams<{itemId:string}>().itemId,id=z.uuid().safeParse(raw);return <ScreenSafeArea><ScrollView contentContainerStyle={{padding:16,gap:16}}><WorkHubPageTitle title={t("workHubLibrary.bundles")}/>{id.success||raw==='new'?<BundleDetail key={String(raw)} itemId={String(raw)}/>:<Text>{t("workHubLibrary.invalidLink")}</Text>}</ScrollView></ScreenSafeArea>;}
