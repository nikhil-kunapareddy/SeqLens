import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';
/* -------------------------------------------------------------------------- */
/* Dialog                                                                     */
/* -------------------------------------------------------------------------- */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export function DialogContent({ className, children, hideClose = false, ...props }) {
    return (_jsxs(DialogPrimitive.Portal, { children: [_jsx(DialogPrimitive.Overlay, { className: cn('fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[1px]', 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0') }), _jsxs(DialogPrimitive.Content, { className: cn('fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2', 'max-h-[88vh] overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-lg', 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95', className), ...props, children: [children, hideClose ? null : (_jsx(DialogPrimitive.Close, { className: "absolute top-3.5 right-3.5 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", "aria-label": "Close", children: _jsx(X, { className: "size-4" }) }))] })] }));
}
export function DialogHeader({ className, ...props }) {
    return _jsx("div", { className: cn('mb-4 space-y-1.5 pr-8', className), ...props });
}
export function DialogTitle({ className, ...props }) {
    return (_jsx(DialogPrimitive.Title, { className: cn('text-sm font-semibold tracking-tight text-foreground', className), ...props }));
}
export function DialogDescription({ className, ...props }) {
    return (_jsx(DialogPrimitive.Description, { className: cn('text-xs leading-relaxed text-muted-foreground', className), ...props }));
}
export function DialogFooter({ className, ...props }) {
    return (_jsx("div", { className: cn('mt-5 flex flex-wrap items-center justify-end gap-2', className), ...props }));
}
/* -------------------------------------------------------------------------- */
/* Popover                                                                    */
/* -------------------------------------------------------------------------- */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export function PopoverContent({ className, align = 'start', sideOffset = 6, ...props }) {
    return (_jsx(PopoverPrimitive.Portal, { children: _jsx(PopoverPrimitive.Content, { align: align, sideOffset: sideOffset, className: cn('z-50 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md', 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className), ...props }) }));
}
/* -------------------------------------------------------------------------- */
/* Dropdown menu                                                              */
/* -------------------------------------------------------------------------- */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export function DropdownMenuContent({ className, align = 'end', sideOffset = 6, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Portal, { children: _jsx(DropdownMenuPrimitive.Content, { align: align, sideOffset: sideOffset, className: cn('z-50 min-w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md', 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className), ...props }) }));
}
export function DropdownMenuItem({ className, destructive = false, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Item, { className: cn('relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none select-none', 'focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0', destructive && 'text-destructive focus:bg-destructive/10 focus:text-destructive', className), ...props }));
}
export function DropdownMenuLabel({ className, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Label, { className: cn('px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase', className), ...props }));
}
export function DropdownMenuSeparator({ className, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Separator, { className: cn('-mx-1 my-1 h-px bg-border', className), ...props }));
}
