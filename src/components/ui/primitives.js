import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as LabelPrimitive from '@radix-ui/react-label';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/utils/cn';
/* -------------------------------------------------------------------------- */
/* Label, input, textarea                                                     */
/* -------------------------------------------------------------------------- */
export function Label({ className, ...props }) {
    return (_jsx(LabelPrimitive.Root, { className: cn('text-xs font-medium text-foreground select-none peer-disabled:opacity-60', className), ...props }));
}
export function Input({ className, type = 'text', ...props }) {
    return (_jsx("input", { type: type, className: cn('h-8 w-full rounded-md border border-input bg-card px-2.5 text-sm text-foreground', 'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/30', 'disabled:cursor-not-allowed disabled:opacity-60', className), ...props }));
}
export function Textarea({ className, ...props }) {
    return (_jsx("textarea", { className: cn('min-h-16 w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm text-foreground', 'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/30', className), ...props }));
}
/* -------------------------------------------------------------------------- */
/* Separator                                                                  */
/* -------------------------------------------------------------------------- */
export function Separator({ className, orientation = 'horizontal', ...props }) {
    return (_jsx(SeparatorPrimitive.Root, { orientation: orientation, className: cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className), ...props }));
}
/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */
export function Progress({ className, value, indeterminate = false, ...props }) {
    return (_jsx(ProgressPrimitive.Root, { className: cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className), value: indeterminate ? null : value, ...props, children: _jsx(ProgressPrimitive.Indicator, { className: cn('h-full rounded-full bg-primary transition-transform duration-200', 
            // An indeterminate bar sweeps rather than sitting at zero, because a
            // stalled-looking bar is worse than an honest "working" signal.
            indeterminate && 'w-1/3 animate-[progress-sweep_1.4s_ease-in-out_infinite]'), style: indeterminate ? undefined : { transform: `translateX(-${100 - (value ?? 0)}%)`, width: '100%' } }) }));
}
/* -------------------------------------------------------------------------- */
/* Switch, checkbox, slider                                                   */
/* -------------------------------------------------------------------------- */
export function Switch({ className, ...props }) {
    return (_jsx(SwitchPrimitive.Root, { className: cn('peer inline-flex h-4.5 w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors', 'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input', 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50', className), ...props, children: _jsx(SwitchPrimitive.Thumb, { className: cn('pointer-events-none block size-3.5 rounded-full bg-white shadow-sm transition-transform', 'data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-0.5') }) }));
}
export function Checkbox({ className, ...props }) {
    return (_jsx(CheckboxPrimitive.Root, { className: cn('peer size-4 shrink-0 rounded border border-input bg-card', 'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground', 'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground', 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50', className), ...props, children: _jsx(CheckboxPrimitive.Indicator, { className: "flex items-center justify-center", children: _jsx(Check, { className: "size-3", strokeWidth: 3 }) }) }));
}
export function Slider({ className, ...props }) {
    return (_jsxs(SliderPrimitive.Root, { className: cn('relative flex w-full touch-none items-center select-none', className), ...props, children: [_jsx(SliderPrimitive.Track, { className: "relative h-1 w-full grow overflow-hidden rounded-full bg-muted", children: _jsx(SliderPrimitive.Range, { className: "absolute h-full bg-primary" }) }), _jsx(SliderPrimitive.Thumb, { className: "block size-3.5 rounded-full border border-primary bg-card shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", "aria-label": "Value" })] }));
}
/* -------------------------------------------------------------------------- */
/* Select                                                                     */
/* -------------------------------------------------------------------------- */
export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;
export function SelectTrigger({ className, children, ...props }) {
    return (_jsxs(SelectPrimitive.Trigger, { className: cn('flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-sm text-foreground', 'data-[placeholder]:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/30', 'disabled:cursor-not-allowed disabled:opacity-60 [&>span]:truncate', className), ...props, children: [children, _jsx(SelectPrimitive.Icon, { asChild: true, children: _jsx(ChevronDown, { className: "size-3.5 shrink-0 text-muted-foreground" }) })] }));
}
export function SelectContent({ className, children, position = 'popper', ...props }) {
    return (_jsx(SelectPrimitive.Portal, { children: _jsxs(SelectPrimitive.Content, { position: position, className: cn('relative z-50 max-h-80 min-w-32 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md', 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1', className), ...props, children: [_jsx(SelectPrimitive.ScrollUpButton, { className: "flex h-5 items-center justify-center", children: _jsx(ChevronUp, { className: "size-3.5" }) }), _jsx(SelectPrimitive.Viewport, { className: "p-1", children: children }), _jsx(SelectPrimitive.ScrollDownButton, { className: "flex h-5 items-center justify-center", children: _jsx(ChevronDown, { className: "size-3.5" }) })] }) }));
}
export function SelectItem({ className, children, ...props }) {
    return (_jsxs(SelectPrimitive.Item, { className: cn('relative flex w-full cursor-pointer items-center rounded-sm py-1.5 pr-7 pl-2 text-sm outline-none select-none', 'focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className), ...props, children: [_jsx(SelectPrimitive.ItemText, { children: children }), _jsx("span", { className: "absolute right-2 flex size-3.5 items-center justify-center", children: _jsx(SelectPrimitive.ItemIndicator, { children: _jsx(Check, { className: "size-3.5 text-primary", strokeWidth: 2.5 }) }) })] }));
}
export function SelectLabel({ className, ...props }) {
    return (_jsx(SelectPrimitive.Label, { className: cn('px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase', className), ...props }));
}
/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }) {
    return (_jsx(TabsPrimitive.List, { className: cn('inline-flex h-8 items-center gap-0.5 rounded-md border border-border bg-muted p-0.5', className), ...props }));
}
export function TabsTrigger({ className, ...props }) {
    return (_jsx(TabsPrimitive.Trigger, { className: cn('inline-flex h-7 items-center justify-center gap-1.5 rounded-sm px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors', 'hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs', 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50', className), ...props }));
}
export function TabsContent({ className, ...props }) {
    return (_jsx(TabsPrimitive.Content, { className: cn('mt-3 focus-visible:outline-none', className), ...props }));
}
/* -------------------------------------------------------------------------- */
/* Toggle group                                                               */
/* -------------------------------------------------------------------------- */
export const ToggleGroup = ToggleGroupPrimitive.Root;
export function ToggleGroupItem({ className, ...props }) {
    return (_jsx(ToggleGroupPrimitive.Item, { className: cn('inline-flex h-7 items-center justify-center gap-1.5 border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors', 'first:rounded-l-md last:rounded-r-md not-first:border-l-0', 'hover:bg-muted hover:text-foreground data-[state=on]:bg-primary-soft data-[state=on]:text-primary', 'focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring', className), ...props }));
}
/* -------------------------------------------------------------------------- */
/* Tooltip                                                                    */
/* -------------------------------------------------------------------------- */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export function TooltipContent({ className, sideOffset = 6, ...props }) {
    return (_jsx(TooltipPrimitive.Portal, { children: _jsx(TooltipPrimitive.Content, { sideOffset: sideOffset, className: cn('z-50 max-w-80 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs leading-relaxed text-popover-foreground shadow-md', 'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0', className), ...props }) }));
}
