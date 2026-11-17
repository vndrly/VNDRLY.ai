import React, {useCallback, useRef} from "react";
import {ScrollView,Text} from "react-native";
import {useLocalSearchParams} from "expo-router";
import {z} from "zod/v4";
import {useTranslation} from "react-i18next";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import EmployeeResponse from "@/components/work-hub/library/EmployeeResponse";
export default function Page(){const scroll=useRef<ScrollView>(null);const onSectionChange=useCallback(()=>scroll.current?.scrollTo({y:0,animated:false}),[]);const {t}=useTranslation(),raw=useLocalSearchParams<{instanceId:string}>().instanceId,id=z.uuid().safeParse(raw);return <ScreenSafeArea><ScrollView ref={scroll} contentContainerStyle={{padding:16,gap:16}}><WorkHubPageTitle title={t("workHubLibrary.assignedWork")}/>{id.success?<EmployeeResponse instanceId={id.data} onSectionChange={onSectionChange}/>:<Text>{t("workHubLibrary.invalidLink")}</Text>}</ScrollView></ScreenSafeArea>;}
