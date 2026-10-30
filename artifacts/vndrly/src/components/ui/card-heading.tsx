import { Children, isValidElement, type HTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, BarChart3, Bell, BriefcaseBusiness, CalendarDays, Camera, ClipboardList, Clock3, FileText, History, MapPin, MessageSquare, Package, PanelsTopLeft, Receipt, Settings2, ShieldCheck, Truck, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import "./card-heading.css";

function titleText(children:ReactNode):string {
  return Children.toArray(children).map(child=>typeof child==="string"||typeof child==="number"?String(child):isValidElement<{children?:ReactNode}>(child)?titleText(child.props.children):"").join(" ");
}
/** A fallback for older cards that supplied a title but no header icon. */
export function CardHeadingIcon({title}:{title:ReactNode}) {
  const text=titleText(title).toLocaleLowerCase();
  const Icon = /alert|warn|flag|riesgo|aviso|exception|attention|gap/.test(text)?AlertTriangle
    :/certif|compliance|safety|seguridad|credential|training|license|verific/.test(text)?ShieldCheck
    :/staff|employee|people|person|crew|team|member|empleado|miembro/.test(text)?Users
    :/invoice|bill|receipt|factura|1099|tax/.test(text)?Receipt
    :/pay|financ|balance|spend|budget|cost|pago|contab/.test(text)?Wallet
    :/shift|schedule|calendar|meeting|turno|calendario|reunión|coverage/.test(text)?CalendarDays
    :/time|hour|watch|hora|guardia/.test(text)?Clock3
    :/task|checklist|tarea|assignment|action/.test(text)?ClipboardList
    :/map|site|gate|location|route|sitio|acceso|ubicación|directions/.test(text)?MapPin
    :/vehicle|truck|fleet|driver|trip|run|load|dispatch|camión|conductor/.test(text)?Truck
    :/histor|activity|audit|replay|actividad/.test(text)?History
    :/report|analytic|metric|trend|pipeline|statistic|informe/.test(text)?BarChart3
    :/file|note|document|library|record|nota|archivo/.test(text)?FileText
    :/notification|notificación/.test(text)?Bell
    :/chat|conversation|message|call|mensaje|llamada/.test(text)?MessageSquare
    :/camera|video|photo|foto|cámara/.test(text)?Camera
    :/inventory|equipment|asset|part|product|inventario/.test(text)?Package
    :/setting|config|preference|policy|admin|role|ajuste/.test(text)?Settings2
    :/company|vendor|partner|business|empresa|proveedor|contact/.test(text)?BriefcaseBusiness:PanelsTopLeft;
  return <Icon aria-hidden="true" className="app-card-fallback-icon" />;
}

export function CardHeading({as:Tag="h2",children,className,...props}:HTMLAttributes<HTMLHeadingElement>&{as?:"h2"|"h3"|"h4"}) {
  return <Tag {...props} data-card-heading-title className={cn("app-card-heading",className)}><CardHeadingIcon title={children}/>{children}</Tag>;
}
