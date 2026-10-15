import React from "react";
import {ScrollView,Text} from "react-native";
import {useLocalSearchParams} from "expo-router";
import {z} from "zod/v4";
import {useTranslation} from "react-i18next";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import LibraryDetail from "@/components/work-hub/library/LibraryDetail";
export default function Page(){const {t}=useTranslation(),raw=useLocalSearchParams<{itemId:string}>().itemId,id=z.uuid().safeParse(raw);return <ScreenSafeArea><ScrollView contentContainerStyle={{padding:16,gap:16}}><WorkHubPageTitle title={t("workHubLibrary.library")}/>{id.success?<LibraryDetail key={id.data} itemId={id.data}/>:<Text>{t("workHubLibrary.invalidLink")}</Text>}</ScrollView></ScreenSafeArea>;}
