import { Component, inject, signal } from '@angular/core';
import { Header } from '../../header/header';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { DELIVERY_SIZES, DELIVERY_SPEEDS } from './order.config';
import { UpperCasePipe } from '@angular/common';
import { DeliveryApi } from '../../services/delivery-api';
import { ToastrService } from 'ngx-toastr';

declare var ymaps: any;

@Component({
    selector: 'app-order',
    imports: [Header, UpperCasePipe, ReactiveFormsModule],
    templateUrl: './order.html',
    styleUrl: './order.css',
})

export class Order {
    public readonly sizes = DELIVERY_SIZES;
    public readonly speeds = DELIVERY_SPEEDS;

    toastr = inject(ToastrService);

    public map: any;
    private mapRoute: any;

    public routeForm: FormGroup;
    public orderForm: FormGroup;

    public orderId: any = signal(null);
    public calculationResult: any = signal(null);

    constructor(private formBuilder: FormBuilder, private deliveryApi: DeliveryApi) {
        this.routeForm = this.formBuilder.group({
            from: ['', Validators.required],
            to: ['', Validators.required],
            size: ['xs', Validators.required],
            speed: ['regular', Validators.required]
        });
        this.orderForm = this.formBuilder.group({
            name: ['', Validators.required],
            phone: ['', [Validators.required]],
            comment: ['']
        });
    }

    ngOnInit() {
        ymaps.ready(() => {
            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => (this.init(pos.coords.latitude, pos.coords.longitude)),
                    () => this.init());
            } else {
                this.init();
            }
        });
    }

    public init(lat: any = null, lon: any = null) {
        this.map = new ymaps.Map('map', {
            center: [lat ?? 55.751244, lon ?? 37.618423],
            zoom: lat && lon ? 15 : 5,
            controls: ['zoomControl']
        });

        // Обратное геокодирование: определяем ближайший адрес по координатам, подставляем в Откуда и добавляем поинт на карту
        if (lat != null && lon != null) {
            ymaps.geocode([lat, lon], { kind: 'house' }).then(
                (res: any) => {
                    const first = res.geoObjects.get(0);
                    if (first?.getAddressLine) {
                        this.routeForm.controls['from'].setValue(first.getAddressLine());
                        this.map.geoObjects.add(first);
                    }
                },
                () => { }
            );
        }

        // Подключаем подсказки адресов к полям от яндекса
        (new ymaps.SuggestView('from')).events.add('select', (event: any) => (this.routeForm.controls['from'].setValue(event.get('item')?.value ?? '')));
        (new ymaps.SuggestView('to')).events.add('select', (event: any) => (this.routeForm.controls['to'].setValue(event.get('item')?.value ?? '')));
    }

    public selectSize(size: string) {
        this.routeForm.controls['size'].setValue(size);
    }

    public selectSpeed(speed: string) {
        this.routeForm.controls['speed'].setValue(speed);
    }

    public calculate() {
        this.calculationResult.set(null);

        if (!this.map || this.routeForm.invalid) {
            return;
        }

        const { from, to, size, speed } = this.routeForm.getRawValue();

        if (this.mapRoute) {
            this.map.geoObjects.remove(this.mapRoute);
            this.mapRoute = null;
        }

        this.mapRoute = new ymaps.multiRouter.MultiRoute(
            { referencePoints: [from, to] },
            { boundsAutoApply: false }
        );
        this.map.geoObjects.add(this.mapRoute);

        this.mapRoute.model.events.add('requestsuccess', () => {
            try {
                const activeRoute = this.mapRoute.getActiveRoute();
                if (!activeRoute) {
                    return this.failedCalculation();
                }

                const km = activeRoute.properties.get('distance').value / 1000;
                const sizeValue = size ?? '';
                const sizeConfig = this.sizes.find((item) => item.value === sizeValue);
                if (!sizeConfig) {
                    return this.failedCalculation();
                }
                let total = Math.max(sizeConfig.min, Math.ceil(km * sizeConfig.rate));
                let duration = Math.min(30, 1 + Math.ceil(km / 80));

                if (speed === 'fast') {
                    total = Math.ceil(total * 1.15);
                    duration = Math.ceil(duration - (duration * 0.30));
                }

                this.calculationResult.set({
                    from,
                    to,
                    size,
                    distance: km.toFixed(1),
                    duration,
                    rate: sizeConfig.rate,
                    total,
                    speed
                });
            } catch (err) {
                this.failedCalculation();
            }
        });

        this.mapRoute.model.events.add('requestfail', () => this.failedCalculation());
    }

    private failedCalculation() {
        this.calculationResult.set(null);
        this.toastr.error('Не удалось построить маршрут. Проверьте адреса и выбранные параметры.');
    }

    public submitOrder() {
        const calculation = this.calculationResult();
        if (!calculation) {
            this.toastr.error('Сначала рассчитайте стоимость, чтобы оформить заявку');
            return;
        }

        if (this.orderForm.invalid) {
            this.toastr.error('Введите имя и корректный телефон');
            return;
        }

        const { name, phone, comment } = this.orderForm.getRawValue();
        const trimmedName = (name ?? '').trim();
        const trimmedPhone = (phone ?? '').trim();
        const trimmedComment = (comment ?? '').trim();

        const payload = {
            customer: { name: trimmedName, phone: trimmedPhone, comment: trimmedComment },
            calculation: calculation,
            createdAt: new Date().toISOString()
        };

        this.deliveryApi.createDelivery(payload).subscribe((response) => {
            if ('error' in response) {
                this.toastr.error(response.error);
                return;
            }
            this.toastr.success('Заявка успешно оформлена!')
            this.orderId.set(response.id);
        });

    }

}
